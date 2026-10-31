import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

// A sessão (tokens) é maior que o limite do SecureStore (~2 KB no iOS).
// Então: chave AES-256 aleatória no Keychain/Keystore, sessão cifrada no AsyncStorage.
// Quem copiar o AsyncStorage (backup, root) leva só dado cifrado.
const keychain = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

const encryptedStorage = {
  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    const hexKey = await SecureStore.getItemAsync(key, keychain);
    if (!encrypted || !hexKey) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(hexKey), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(encrypted)));
  },
  async setItem(key: string, value: string) {
    // chave nova a cada gravação: nunca reutiliza o par chave/contador do CTR
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(rawKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(rawKey), keychain);
    await AsyncStorage.setItem(key, aesjs.utils.hex.fromBytes(encrypted));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key, keychain);
  },
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) throw new Error('Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_KEY no app/.env');

export const supabase = createClient(url, key, {
  auth: {
    storage: encryptedStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Só renova o token com o app em primeiro plano.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// Traduz erros do banco (hints definidos nas migrations) para mensagens de tela.
export function errorMessage(error: unknown): string {
  const e = error as { code?: string; hint?: string; message?: string; status?: number } | null;
  if (e?.hint === 'premium_required') return 'Esse recurso é do plano premium.';
  if (e?.hint === 'plan_limit') return 'Você chegou ao limite do seu plano.';
  if (e?.code === 'rate_limited' || e?.status === 429) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (e?.code === 'invalid_credentials') return 'E-mail ou senha incorretos.';
  if (e?.code === 'email_not_confirmed') return 'Confirme seu e-mail antes de entrar.';
  if (e?.code === 'weak_password') return 'Senha fraca: use 10+ caracteres com maiúscula, minúscula e número.';
  if (e?.code === 'user_already_exists') return 'Já existe uma conta com esse e-mail.';
  if (e?.code === 'otp_expired') return 'Código inválido ou expirado.';
  return e?.message ?? 'Algo deu errado. Tente de novo.';
}
