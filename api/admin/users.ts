import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { email, password, full_name, phone, role, condominium_id } = req.body

    // Criar usuário no Auth
    const { data: authData, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role }
      })

    if (createError) throw createError

    // Criar profile
const { data: profile, error: profileError } = await supabaseAdmin
  .from('profiles')
  .insert([{
    id: authData.user.id,
    full_name,
    email,
    phone,
    role,
    condominium_id,
    active: true
  }])
  .select()
  .single();

if (profileError) throw profileError;

return res.status(200).json({
  user: authData.user,
  profile
});

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
