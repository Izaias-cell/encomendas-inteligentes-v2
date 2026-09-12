import { verifyPassword } from './src/services/authCrypto';

async function check() {
  const hash = '$argon2id$v=19$m=65536,p=1,t=3$nOujhFM/QdTtMEoKd4JP6Q$r/dSFDz8SvV4fg0PTb7wRgJXoqDROmMOr48zs+d2gQI';
  const passwords = [
    'Administrador@123',
    'Admin@123456',
    'admin123',
    'Admin1234',
    'admin@123',
    'Administrador123',
    'TesteAdmin@123',
    'AdminTeste@123',
  ];
  for (const p of passwords) {
    const ok = await verifyPassword(p, hash);
    if (ok) {
      console.log('PASSWORD FOUND:', p);
      return;
    }
  }
  console.log('None of the list matched');
}

check();
