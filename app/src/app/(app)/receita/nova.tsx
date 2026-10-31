import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image } from 'react-native';
import { Button, Chip, Chips, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

const recipeTags = ['rápida', 'airfryer', 'forno', 'fogão', 'vegetariana', 'sem glúten', 'doce', 'fit'];
const visibilities = [
  { value: 'private', label: '🔒 Só eu' },
  { value: 'family', label: '👪 Minha família' },
  { value: 'public', label: '🌎 Comunidade' },
] as const;

export default function NewRecipe() {
  const { session } = useSession();
  const { family } = useFamily();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [minutes, setMinutes] = useState('');
  const [servings, setServings] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [steps, setSteps] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<string>('family');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

  async function pickPhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.7 });
    if (!r.canceled) setPhoto(r.assets[0]);
  }

  async function save() {
    if (!title.trim()) return setError('Dê um nome à receita.');
    if (lines(ingredients).length === 0) return setError('Liste ao menos um ingrediente.');
    setError('');
    setLoading(true);
    let photo_path: string | null = null;
    if (photo) {
      photo_path = `${session!.user.id}/${Date.now()}.jpg`;
      const body = await (await fetch(photo.uri)).arrayBuffer();
      const { error } = await supabase.storage.from('recipe-photos').upload(photo_path, body, { contentType: photo.mimeType ?? 'image/jpeg' });
      if (error) { setLoading(false); return setError(errorMessage(error)); }
    }
    const { data, error } = await supabase.from('recipes').insert({
      title: title.trim(), description: description.trim() || null,
      prep_minutes: minutes ? Number(minutes) : null, servings: servings ? Number(servings) : null,
      // ponytail: ingrediente é só o texto da linha; quantidade/unidade separadas quando a IA/lista precisar
      ingredients: lines(ingredients).map((name) => ({ name })), steps: lines(steps), tags, photo_path,
      visibility, family_id: family?.id ?? null,
    }).select('id').single();
    setLoading(false);
    if (error) return setError(errorMessage(error));
    router.replace({ pathname: '/receita/[id]', params: { id: data.id } });
  }

  return (
    <Screen>
      <Field label="Nome" value={title} onChangeText={setTitle} placeholder="Ex.: Estrogonofe de frango" maxLength={120} />
      <Field label="Resumo (opcional)" value={description} onChangeText={setDescription} maxLength={1000} />
      <Field label="Tempo (min)" value={minutes} onChangeText={(v) => setMinutes(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} />
      <Field label="Porções" value={servings} onChangeText={(v) => setServings(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
      <Field label="Ingredientes (um por linha)" value={ingredients} onChangeText={setIngredients} multiline
        placeholder={'500 g de frango\n1 caixa de creme de leite'} />
      <Field label="Modo de preparo (um passo por linha)" value={steps} onChangeText={setSteps} multiline />

      <Section>Tags</Section>
      <Chips>
        {recipeTags.map((t) => (
          <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))} />
        ))}
      </Chips>

      <Section>Quem vê</Section>
      <Chips>{visibilities.map((v) => <Chip key={v.value} label={v.label} selected={visibility === v.value} onPress={() => setVisibility(v.value)} />)}</Chips>
      {visibility === 'public' && <Muted>Receitas da comunidade podem ser vistas por qualquer usuário do app.</Muted>}

      <Section>Foto</Section>
      {photo && <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 200, borderRadius: 12 }} />}
      <Button title={photo ? 'Trocar foto' : 'Adicionar foto'} variant="link" onPress={pickPhoto} />

      <ErrorText>{error}</ErrorText>
      <Button title="Salvar receita" onPress={save} loading={loading} />
    </Screen>
  );
}
