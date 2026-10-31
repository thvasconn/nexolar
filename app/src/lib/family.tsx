import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSession } from './session';
import { supabase } from './supabase';

export type Family = { id: string; name: string; owner_id: string };
export type Member = {
  id: string;
  user_id: string | null;
  role: 'admin' | 'adult' | 'child';
  display_name: string | null;
  relationship: string | null;
  birth_date: string | null;
  kind: 'person' | 'pet';
  color: string | null;
  profiles: { full_name: string; birth_date: string | null } | null;
};

// Cor da pessoa na agenda: a escolhida pelo admin ou uma da paleta pela ordem de entrada.
const palette = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
export const memberColor = (m: Member | undefined, members: Member[]) =>
  m?.color ?? palette[Math.max(0, members.findIndex((x) => x.id === m?.id)) % palette.length];
export const colorPalette = palette;

export const memberName = (m: Member) => m.display_name ?? m.profiles?.full_name ?? 'Sem nome';
export const memberBirth = (m: Member) => m.birth_date ?? m.profiles?.birth_date ?? null;

type FamilyState = {
  loading: boolean;
  families: Family[];
  family: Family | null;
  members: Member[];
  me: Member | null;
  isAdmin: boolean;
  selectFamily: (id: string) => void;
  reload: () => Promise<void>;
};

const FamilyContext = createContext<FamilyState | null>(null);
const STORAGE_KEY = 'familia-atual';

// Para telas fora do FamilyProvider (ex.: aceite de convite) escolherem a família atual.
export const rememberFamily = (id: string) => AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});

// Família "atual" do app. Quem tem mais de uma troca no Início.
export function FamilyProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const uid = session?.user.id;
  const [loading, setLoading] = useState(true);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('families').select('id, name, owner_id').order('created_at');
    const list = data ?? [];
    setFamilies(list);
    const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    const current = list.find((f) => f.id === saved) ?? list[0] ?? null;
    setFamilyId(current?.id ?? null);
    if (current) {
      const { data: m } = await supabase.from('family_members')
        .select('id, user_id, role, display_name, relationship, birth_date, kind, color, profiles(full_name, birth_date)')
        .eq('family_id', current.id).order('created_at');
      setMembers((m ?? []) as unknown as Member[]);
    } else {
      setMembers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (uid) reload(); }, [uid, reload]);

  const selectFamily = (id: string) => {
    AsyncStorage.setItem(STORAGE_KEY, id).finally(reload);
  };

  const family = families.find((f) => f.id === familyId) ?? null;
  const me = members.find((m) => m.user_id === uid) ?? null;

  return (
    <FamilyContext.Provider value={{ loading, families, family, members, me, isAdmin: me?.role === 'admin', selectFamily, reload }}>
      {children}
    </FamilyContext.Provider>
  );
}

export function useFamily() {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error('useFamily fora do FamilyProvider');
  return ctx;
}
