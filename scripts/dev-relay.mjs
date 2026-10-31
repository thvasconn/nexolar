// WSL em modo mirrored não repassa ao Windows (nem ao celular) as portas publicadas pelo Docker.
// O Supabase local roda nas portas 553xx e este repasse em Node expõe as portas de sempre (543xx).
// Uso: `npm run db:relay` (o `npm run start:lan` do app já sobe junto).
import net from 'node:net';

const routes = [
  { port: 54321, target: 55321, host: '0.0.0.0', name: 'API (celular precisa)' },
  // sem senha: fica só no PC, nunca na rede
  { port: 54323, target: 55323, host: '127.0.0.1', name: 'Studio' },
  { port: 54324, target: 55324, host: '127.0.0.1', name: 'Mailpit' },
];

for (const { port, target, host, name } of routes) {
  net.createServer((client) => {
    const upstream = net.connect(target, '127.0.0.1');
    client.pipe(upstream).pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  })
    .on('error', (e) => {
      if (e.code === 'EADDRINUSE') console.log(`${name}: repasse já está rodando em :${port}`);
      else throw e;
    })
    .listen(port, host, () => console.log(`${name}: http://${host === '0.0.0.0' ? '<ip-da-rede>' : '127.0.0.1'}:${port} -> :${target}`));
}
