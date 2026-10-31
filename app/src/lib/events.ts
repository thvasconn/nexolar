export const eventTypes = [
  { value: 'birthday', label: '🎂 Aniversário' },
  { value: 'meal', label: '🍽️ Almoço/jantar' },
  { value: 'party', label: '🎉 Festa' },
  { value: 'meeting', label: '🗓️ Reunião' },
  { value: 'secret_santa', label: '🎁 Amigo oculto' },
  { value: 'other', label: '✨ Outro' },
] as const;

export const eventTypeLabel = (type: string) => eventTypes.find((t) => t.value === type)?.label ?? type;

export const rsvpLabel: Record<string, string> = { pending: 'sem resposta', yes: 'vai', no: 'não vai', maybe: 'talvez' };
