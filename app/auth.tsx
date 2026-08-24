/** 매직링크 로그인 화면 (stage-1 §1-2). 디자인 폴리싱은 Stage 8. */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { sendMagicLink } from '@/data/auth';
import { useTheme } from '@/ui/theme';
import { type ThemeColors } from '@/ui/tokens';

export default function Auth() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async () => {
    if (!email.includes('@') || state === 'sending') return;
    setState('sending');
    try {
      await sendMagicLink(email.trim());
      setState('sent');
    } catch (e) {
      setErrorMsg(String(e));
      setState('error');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="height">
      <View style={styles.box}>
        <Text style={styles.title}>Chrona</Text>
        {state === 'sent' ? (
          <>
            <Text style={styles.body}>메일함을 확인하세요.</Text>
            <Text style={styles.sub}>
              {email}로 로그인 링크를 보냈습니다.{'\n'}폰에서 링크를 열면 앱으로 돌아옵니다.
            </Text>
            <Pressable onPress={() => setState('idle')}>
              <Text style={styles.link}>다시 보내기</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.body}>이메일로 로그인</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              onSubmitEditing={submit}
            />
            <Pressable style={styles.button} onPress={submit} disabled={state === 'sending'}>
              {state === 'sending' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.buttonText}>매직링크 보내기</Text>
              )}
            </Pressable>
            {state === 'error' && <Text style={styles.error}>{errorMsg}</Text>}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  box: { gap: 16 },
  title: { color: colors.text, fontSize: 32, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.text, fontSize: 20, fontWeight: '600' },
  sub: { color: colors.textSub, fontSize: 15, lineHeight: 22 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { color: colors.accent, fontSize: 15 },
  error: { color: colors.danger, fontSize: 13 },
});
