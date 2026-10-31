import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { Button, colors, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

// dd/mm/aaaa <-> aaaa-mm-dd
const toIso = (br: string) => {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T12:00:00`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(iso) && d <= new Date() && m[3] >= '1900' ? iso : null;
};
const toBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

export default function Profile() {
  const { session } = useSession();
  const uid = session!.user.id;
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('profiles').select('full_name, birth_date, avatar_path').eq('id', uid).single()
      .then(async ({ data, error }) => {
        if (error) return setError(errorMessage(error));
        setName(data.full_name);
        setBirth(toBr(data.birth_date));
        if (data.avatar_path) {
          const { data: signed } = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
          setPhoto(signed?.signedUrl ?? null);
        }
      });
  }, [uid]);

  async function pickPhoto() {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const path = `${uid}/avatar.jpg`;
    const body = await (await fetch(asset.uri)).arrayBuffer();
    const { error } = await supabase.storage.from('avatars')
      .upload(path, body, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
    if (error) return setError(errorMessage(error));
    await supabase.from('profiles').update({ avatar_path: path }).eq('id', uid);
    setPhoto(asset.uri);
  }

  async function save() {
    const birthIso = birth.trim() ? toIso(birth.trim()) : null;
    if (birth.trim() && !birthIso) return setError('Data inválida. Use dd/mm/aaaa.');
    if (!name.trim()) return setError('Informe seu nome.');
    setError('');
    setLoading(true);
    const { error } = await supabase.from('profiles')
      .update({ full_name: name.trim(), birth_date: birthIso }).eq('id', uid);
    setLoading(false);
    if (error) return setError(errorMessage(error));
    setSaved(true);
  }

  return (
    <Screen>
      <Pressable onPress={pickPhoto} accessibilityRole="button" accessibilityLabel="Trocar foto" style={styles.photoWrap}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : <Text style={styles.photoText}>Adicionar foto</Text>}
      </Pressable>
      <Field label="Nome" value={name} onChangeText={(v) => { setName(v); setSaved(false); }} maxLength={100} />
      <Field label="Aniversário" value={birth} onChangeText={(v) => { setBirth(v); setSaved(false); }}
        placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Muted>A família recebe um lembrete no seu aniversário.</Muted>
      <ErrorText>{error}</ErrorText>
      {saved && <Muted>Salvo.</Muted>}
      <Button title="Salvar" onPress={save} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoWrap: {
    width: 112, height: 112, borderRadius: 56, alignSelf: 'center', backgroundColor: '#eef2ff',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 8,
  },
  photo: { width: 112, height: 112 },
  photoText: { color: colors.primary, fontWeight: '600' },
});
