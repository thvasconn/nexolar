// Depois do código de recuperação o usuário já fica logado; esta flag manda ele definir a senha nova antes de tudo.
let pending = false;
export const setPasswordResetPending = (v: boolean) => { pending = v; };
export const isPasswordResetPending = () => pending;
