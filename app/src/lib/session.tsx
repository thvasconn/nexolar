import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

type SessionState = { session: Session | null; loading: boolean };

const SessionContext = createContext<SessionState>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setState({ session: data.session, loading: false }))
      // sessão ilegível (ex.: chave apagada do Keychain) = trata como deslogado em vez de travar na abertura
      .catch(() => setState({ session: null, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

// Convite aberto antes do login fica guardado até a pessoa entrar.
// ponytail: só em memória; se o app for fechado no meio, basta tocar no link de novo
let pendingInvite: string | null = null;
export const setPendingInvite = (token: string | null) => { pendingInvite = token; };
export const takePendingInvite = () => { const t = pendingInvite; pendingInvite = null; return t; };
