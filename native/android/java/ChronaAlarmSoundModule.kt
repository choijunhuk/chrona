package com.choi.chrona.widget

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray

/**
 * 알람음 네이티브 재생 (마스터 §3.10).
 *
 * expo-audio(USAGE_MEDIA)·알림 채널 사운드(USAGE_NOTIFICATION)는 진동/무음 모드에서
 * 그대로 묵음이 된다. 알람은 USAGE_ALARM + STREAM_ALARM 으로만 무음 모드를 뚫는다.
 * (레퍼런스: rusty-alarm AlarmRingService)
 *
 * - play  : 알람 본재생. STREAM_ALARM 최대로 올리고(원복 보관) 오디오 포커스 독점 + PARTIAL_WAKE_LOCK.
 * - preview: 피커용 3초 시청. 볼륨 강제·포커스 독점 없음.
 * - stop  : 둘 다 정지 + 볼륨/포커스/웨이크락 원복.
 */
class ChronaAlarmSoundModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ChronaAlarmSound"

    private val handler = Handler(Looper.getMainLooper())

    private var player: MediaPlayer? = null
    private var currentSource: String? = null
    private var rampRunnable: Runnable? = null
    private var previewStop: Runnable? = null
    private var savedAlarmVolume: Int = -1
    private var focusRequest: AudioFocusRequest? = null
    private var wakeLock: PowerManager.WakeLock? = null

    // ─── JS API ─────────────────────────────────────────

    /**
     * @param source 'default' | 'alarm_01'..'alarm_04' (res/raw) | content:// | file:// (시스템 벨소리)
     * @param rampSeconds >0 이면 0에서 목표 볼륨까지 선형 증가 (초당 4틱)
     * @param volumePercent 0~100. STREAM_ALARM 최대치에 곱해지는 비율
     */
    @ReactMethod
    fun play(source: String, loop: Boolean, rampSeconds: Int, volumePercent: Int, promise: Promise) {
        try {
            // 같은 소리가 이미 울리는 중이면 건드리지 않는다 (FGS 재시작으로 인한 재생 끊김 방지)
            if (player != null && currentSource == source && previewStop == null) {
                promise.resolve(true)
                return
            }
            releasePlayback()

            val scale = volumePercent.coerceIn(0, 100) / 100f
            forceMaxAlarmVolume()
            requestAudioFocus(exclusive = true)
            acquireWakeLock()

            startPlayer(source, loop, rampSeconds, scale, fallback = true)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("alarm_sound_play_failed", e)
        }
    }

    /** 피커 미리듣기: 3초, 루프 없음, 현재 알람 볼륨 그대로 */
    @ReactMethod
    fun preview(source: String, promise: Promise) {
        try {
            releasePlayback()
            startPlayer(source, loop = false, rampSeconds = 0, scale = 1f, fallback = true)
            val stopper = Runnable { releasePlayback() }
            previewStop = stopper
            handler.postDelayed(stopper, PREVIEW_MILLIS)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("alarm_sound_preview_failed", e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            releasePlayback()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("alarm_sound_stop_failed", e)
        }
    }

    @ReactMethod
    fun isPlaying(promise: Promise) {
        promise.resolve(runCatching { player?.isPlaying == true }.getOrDefault(false))
    }

    /** 기기에 설치된 알람 벨소리 목록 (최대 30건) */
    @ReactMethod
    fun listSystemAlarmSounds(promise: Promise) {
        try {
            val out: WritableArray = Arguments.createArray()
            val manager = RingtoneManager(reactApplicationContext)
            manager.setType(RingtoneManager.TYPE_ALARM)
            val cursor = manager.cursor
            var i = 0
            while (cursor.moveToNext() && i < MAX_SYSTEM_SOUNDS) {
                val title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX) ?: continue
                val uri = manager.getRingtoneUri(cursor.position)?.toString() ?: continue
                val item = Arguments.createMap()
                item.putString("title", title)
                item.putString("uri", uri)
                out.pushMap(item)
                i++
            }
            promise.resolve(out)
        } catch (e: Exception) {
            // 벨소리 조회 실패는 알람 동작과 무관 — 빈 목록으로 넘어간다
            promise.resolve(Arguments.createArray())
        }
    }

    // ─── 재생 ───────────────────────────────────────────

    private fun startPlayer(
        source: String,
        loop: Boolean,
        rampSeconds: Int,
        scale: Float,
        fallback: Boolean,
    ) {
        val uri = uriFor(source)
        try {
            val mp = MediaPlayer()
            mp.setDataSource(reactApplicationContext, uri)
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            mp.isLooping = loop
            if (rampSeconds > 0) mp.setVolume(0f, 0f) else mp.setVolume(scale, scale)
            mp.setOnErrorListener { _, _, _ ->
                // 벨소리 URI가 죽었거나 코덱 실패 — 알람이 무음으로 끝나면 안 되므로 기본음으로
                if (fallback) recoverToDefault(loop, rampSeconds, scale)
                true
            }
            mp.setOnPreparedListener {
                runCatching { it.start() }
                if (rampSeconds > 0) startRamp(rampSeconds, scale)
            }
            player = mp
            currentSource = source
            mp.prepareAsync()
        } catch (e: Exception) {
            if (fallback) recoverToDefault(loop, rampSeconds, scale) else throw e
        }
    }

    private fun recoverToDefault(loop: Boolean, rampSeconds: Int, scale: Float) {
        releasePlayer()
        runCatching { startPlayer(DEFAULT_RAW, loop, rampSeconds, scale, fallback = false) }
    }

    private fun uriFor(source: String): Uri {
        if (source.startsWith("content://") || source.startsWith("file://")) {
            return Uri.parse(source)
        }
        val raw = if (source == "default" || source.isEmpty()) DEFAULT_RAW else source
        return Uri.parse("android.resource://${reactApplicationContext.packageName}/raw/$raw")
    }

    /** 0 → scale 선형 증가 (초당 4틱) */
    private fun startRamp(rampSeconds: Int, scale: Float) {
        cancelRamp()
        val steps = rampSeconds * 4
        var step = 0
        val runnable = object : Runnable {
            override fun run() {
                step++
                val v = (step.toFloat() / steps * scale).coerceIn(0f, scale)
                runCatching { player?.setVolume(v, v) }
                if (step < steps) handler.postDelayed(this, RAMP_TICK_MILLIS)
            }
        }
        rampRunnable = runnable
        handler.postDelayed(runnable, RAMP_TICK_MILLIS)
    }

    private fun cancelRamp() {
        rampRunnable?.let { handler.removeCallbacks(it) }
        rampRunnable = null
    }

    private fun releasePlayer() {
        player?.let { mp ->
            runCatching { mp.setOnErrorListener(null) }
            runCatching { if (mp.isPlaying) mp.stop() }
            runCatching { mp.release() }
        }
        player = null
        currentSource = null
    }

    /** 재생 정지 + 시스템 상태(볼륨·포커스·웨이크락) 원복 */
    private fun releasePlayback() {
        cancelRamp()
        previewStop?.let { handler.removeCallbacks(it) }
        previewStop = null
        releasePlayer()
        restoreAlarmVolume()
        abandonAudioFocus()
        releaseWakeLock()
    }

    // ─── 시스템 상태 ────────────────────────────────────

    private fun audioManager(): AudioManager =
        reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private fun forceMaxAlarmVolume() {
        try {
            val am = audioManager()
            if (savedAlarmVolume < 0) savedAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
            am.setStreamVolume(
                AudioManager.STREAM_ALARM,
                am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0,
            )
        } catch (_: SecurityException) {
            // DND 정책상 볼륨 변경이 막힌 기기 — 현재 볼륨으로 그냥 울린다
        } catch (_: Exception) {
        }
    }

    private fun restoreAlarmVolume() {
        if (savedAlarmVolume < 0) return
        try {
            audioManager().setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0)
        } catch (_: SecurityException) {
        } catch (_: Exception) {
        }
        savedAlarmVolume = -1
    }

    @Suppress("DEPRECATION")
    private fun requestAudioFocus(exclusive: Boolean) {
        val gain = if (exclusive) {
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
        } else {
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        }
        try {
            val am = audioManager()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = AudioFocusRequest.Builder(gain)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    .setOnAudioFocusChangeListener { /* 알람은 포커스를 넘기지 않는다 */ }
                    .build()
                focusRequest = req
                am.requestAudioFocus(req)
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_ALARM, gain)
            }
        } catch (_: Throwable) {
        }
    }

    @Suppress("DEPRECATION")
    private fun abandonAudioFocus() {
        try {
            val am = audioManager()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                am.abandonAudioFocus(null)
            }
        } catch (_: Throwable) {
        }
        focusRequest = null
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = reactApplicationContext
                .getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_MILLIS)
            }
        } catch (_: Throwable) {
        }
    }

    private fun releaseWakeLock() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
    }

    override fun invalidate() {
        releasePlayback()
        super.invalidate()
    }

    companion object {
        private const val DEFAULT_RAW = "alarm_default"
        private const val PREVIEW_MILLIS = 3_000L
        private const val RAMP_TICK_MILLIS = 250L
        private const val MAX_SYSTEM_SOUNDS = 30
        private const val WAKE_LOCK_MILLIS = 15L * 60 * 1000
        private const val WAKE_LOCK_TAG = "Chrona:AlarmSound"
    }
}
