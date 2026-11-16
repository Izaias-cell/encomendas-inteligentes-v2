/**
 * TESTES DE CONSULTA DE PERFIS E ISOLAMENTO DE CONDOMÍNIO
 *
 * Executa validação do contrato de consulta de porteiros/perfis usando cliente
 * simulado em memória (sem conexão ao Supabase de produção e sem dados reais de moradores).
 */

interface MockProfile {
  id: string;
  full_name: string;
  role: 'admin' | 'sindico' | 'porteiro';
  condominium_id: string | null;
  active: boolean;
}

const FIXTURE_PROFILES: MockProfile[] = [
  {
    id: 'prof-a1',
    full_name: 'Carlos Porteiro A',
    role: 'porteiro',
    condominium_id: 'condo-a',
    active: true
  },
  {
    id: 'prof-a2',
    full_name: 'Ana Síndica A',
    role: 'sindico',
    condominium_id: 'condo-a',
    active: true
  },
  {
    id: 'prof-a3',
    full_name: 'Bruno Inativo A',
    role: 'porteiro',
    condominium_id: 'condo-a',
    active: false
  },
  {
    id: 'prof-b1',
    full_name: 'Diego Porteiro B',
    role: 'porteiro',
    condominium_id: 'condo-b',
    active: true
  }
];

function createIsolatedProfilesQueryClient(rows: MockProfile[]) {
  return {
    from: (table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Tabela inesperada: ${table}`);
      }
      const filters: Array<{ field: keyof MockProfile; value: any }> = [];
      const builder: any = {
        select: () => builder,
        eq: (field: keyof MockProfile, value: any) => {
          filters.push({ field, value });
          return builder;
        },
        order: (field: keyof MockProfile) => {
          const filtered = rows
            .filter((r) => filters.every((f) => r[f.field] === f.value))
            .sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')));
          return Promise.resolve({ data: filtered, error: null });
        }
      };
      return builder;
    }
  };
}

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  } else {
    console.error(`❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

async function runProfileQueryTests() {
  console.log('\n======================================================');
  console.log('👤 TESTES DE CONSULTA DE PERFIS E ISOLAMENTO POR CONDOMÍNIO');
  console.log('======================================================\n');

  const client = createIsolatedProfilesQueryClient(FIXTURE_PROFILES);

  const { data: portersCondoA, error: errA } = await client
    .from('profiles')
    .select('*')
    .eq('condominium_id', 'condo-a')
    .eq('role', 'porteiro')
    .eq('active', true)
    .order('full_name');

  assert(!errA && Array.isArray(portersCondoA), '1. Consulta de porteiros retorna array sem erros');
  assert(
    portersCondoA.length === 1 && portersCondoA[0].id === 'prof-a1',
    '2. Filtra estritamente porteiros ativos pertencentes ao condomínio A (exclui inativos, síndicos e condomínio B)'
  );

  const { data: portersCondoB } = await client
    .from('profiles')
    .select('*')
    .eq('condominium_id', 'condo-b')
    .eq('role', 'porteiro')
    .eq('active', true)
    .order('full_name');

  assert(
    portersCondoB.length === 1 && portersCondoB[0].id === 'prof-b1' && !portersCondoB.some((p: any) => p.condominium_id === 'condo-a'),
    '3. Isolamento garantido na consulta do condomínio B'
  );

  console.log('\n------------------------------------------------------');
  console.log(`TOTAL APROVADOS: ${passed}/${total}`);
  console.log('======================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runProfileQueryTests().catch((err) => {
  console.error('Erro nos testes de perfis:', err);
  process.exit(1);
});
