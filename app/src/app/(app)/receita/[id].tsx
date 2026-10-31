import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Text } from 'react-native';
import { Button, colors, ErrorText, Muted, Screen, Section, Title } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { today } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Recipe = {
  id: string; owner_id: string; title: string; description: string | null; prep_minutes: number | null;
  servings: number | null; ingredients: { name: string }[]; steps: string[]; tags: string[];
  visibility: 'private' | 'family' | 'public'; photo_path: string | null;
};

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { family } = useFamily();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    supabase.from('recipes').select('id, owner_id, title, description, prep_minutes, servings, ingredients, steps, tags, visibility, photo_path')
      .eq('id', id).single()
      .then(async ({ data, error }) => {
        if (error) return setError(errorMessage(error));
        setRecipe(data as Recipe);
        if (data.photo_path) {
          const { data: signed } = await supabase.storage.from('recipe-photos').createSignedUrl(data.photo_path, 3600);
          setPhoto(signed?.signedUrl ?? null);
        }
      });
  }, [id]);

  if (!recipe) return <Screen><ErrorText>{error}</ErrorText></Screen>;
  const mine = recipe.owner_id === session?.user.id;

  // Ingredientes vão para a lista aberta mais recente da família (ou para uma nova).
  async function toShoppingList() {
    if (!family) return;
    setError('');
    let { data: list } = await supabase.from('shopping_lists').select('id').eq('family_id', family.id)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!list) {
      const created = await supabase.from('shopping_lists')
        .insert({ family_id: family.id, name: `Compras ${today().slice(0, 5)}` }).select('id').single();
      if (created.error) return setError(errorMessage(created.error));
      list = created.data;
    }
    const { error } = await supabase.from('shopping_items')
      .insert(recipe!.ingredients.map((i) => ({ list_id: list!.id, name: i.name.slice(0, 120) })));
    if (error) return setError(errorMessage(error));
    setInfo(`${recipe!.ingredients.length} ingrediente(s) adicionados à lista.`);
  }

  function report() {
    Alert.alert('Denunciar receita?', 'A equipe vai revisar o conteúdo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Denunciar', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('content_reports').insert({ recipe_id: id, reason: 'Denúncia pelo app' });
        setInfo(error ? errorMessage(error) : 'Obrigado. Vamos revisar.');
      } },
    ]);
  }

  function remove() {
    Alert.alert('Apagar receita?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        await supabase.from('recipes').delete().eq('id', id);
        if (recipe!.photo_path) await supabase.storage.from('recipe-photos').remove([recipe!.photo_path]);
        router.back();
      } },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: recipe.title }} />
      {photo && <Image source={{ uri: photo }} style={{ width: '100%', height: 220, borderRadius: 12 }} accessibilityIgnoresInvertColors />}
      <Title>{recipe.title}</Title>
      <Muted>{[recipe.prep_minutes && `${recipe.prep_minutes} min`, recipe.servings && `${recipe.servings} porções`, ...recipe.tags].filter(Boolean).join(' · ')}</Muted>
      {recipe.description ? <Muted>{recipe.description}</Muted> : null}

      <Section>Ingredientes</Section>
      {recipe.ingredients.map((i, n) => <Text key={n} style={{ color: colors.text, fontSize: 16 }}>• {i.name}</Text>)}
      <Button title="🛒 Adicionar à lista de compras" variant="link" onPress={toShoppingList} />

      {recipe.steps.length > 0 && <Section>Modo de preparo</Section>}
      {recipe.steps.map((s, n) => <Text key={n} style={{ color: colors.text, fontSize: 16, marginBottom: 6 }}>{n + 1}. {s}</Text>)}

      {info ? <Muted>{info}</Muted> : null}
      <ErrorText>{error}</ErrorText>
      {mine ? <Button title="Apagar receita" variant="link" onPress={remove} />
        : recipe.visibility === 'public' && <Button title="Denunciar" variant="link" onPress={report} />}
    </Screen>
  );
}
