/** 매직링크 로그인 화면 (stage-1 §1-2). 디자인 폴리싱은 Stage 8. */
import { useState } from 'react';
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

export default function Auth() {
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
              placeholderTextColor="#5E6473"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              onSubmitEditing={submit}
            />
            <Pressable style={styles.button} onPress={submit} disabled={state === 'sending'}>
              {state === 'sending' ? (
                <ActivityIndicator color="#EDEFF5" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E0F13', justifyContent: 'center', padding: 24 },
  box: { gap: 16 },
  title: { color: '#EDEFF5', fontSize: 32, fontWeight: '700', textAlign: 'center' },
  body: { color: '#EDEFF5', fontSize: 20, fontWeight: '600' },
  sub: { color: '#9BA1B0', fontSize: 15, lineHeight: 22 },
  input: {
    backgroundColor: '#17191F',
    borderColor: '#282C36',
    borderWidth: 1,
    borderRadius: 14,
    color: '#EDEFF5',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  button: {
    backgroundColor: '#6C7BFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#EDEFF5', fontSize: 15, fontWeight: '600' },
  link: { color: '#6C7BFF', fontSize: 15 },
  error: { color: '#FF6B6B', fontSize: 13 },
});
