import { supabaseStore } from './src/services/supabaseStore';

async function main() {
  try {
    const cred = await supabaseStore.findCredencialByIdentificador('admin.teste');
    console.log('Credencial admin.teste:', cred);
    const users = await supabaseStore.listUsuarios('condo-1');
    console.log('Usuarios condo-1:', users.map(u => ({ id: u.id, nome: u.nome, role: u.role })));
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
