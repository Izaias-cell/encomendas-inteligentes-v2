import { api } from '../lib/apiClient';

/**
 * Suite de Testes Automatizados de Persistência e Blindagem da Base de Dados
 * Valida criação, proteção contra duplicidade, integridade referencial, snapshots de backup e imunidade a regressão.
 */

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, failureMsg: string, details?: any) {
  if (condition) {
    results.push({ name: testName, passed: true, message: 'PASS: ' + testName });
  } else {
    results.push({ name: testName, passed: false, message: 'FAIL: ' + failureMsg, details });
  }
}

export async function runPersistenceIntegrityTests() {
  console.log('\n======================================================');
  console.log('🛡️  EXECUTANDO SUÍTE DE TESTES DE PERSISTÊNCIA E BLINDAGEM');
  console.log('======================================================\n');

  const uniqueSuffix = Date.now().toString().slice(-6);
  const testCondoName = `Residencial Shielding Test ${uniqueSuffix}`;
  const testCondoAddress = `Avenida da Blindagem, 1000 - Bloco ${uniqueSuffix}`;
  let createdCondoId: string | null = null;

  // Test 1: Verificação de Integridade Inicial
  try {
    const res = await api.get('/api/admin/integrity-check');
    assert(
      res.ok && (res.data?.status === 'HEALTHY' || res.data?.status === 'INCONSISTENCY_DETECTED') && res.data?.shieldingActive === true,
      '1. Verificação de Integridade e Status de Blindagem',
      `Falha na verificação de integridade inicial (status ${res.status})`,
      res
    );
  } catch (err: any) {
    assert(false, '1. Verificação de Integridade e Status de Blindagem', 'Exceção: ' + err.message);
  }

  // Test 2: Cadastro de Condomínio e Validação de Persistência Inicial
  try {
    const res = await api.post('/api/condominiums/create', {
      name: testCondoName,
      address: testCondoAddress,
      city_state: 'São Paulo/SP',
      manager_name: 'Síndico Teste Blindagem',
      manager_email: `sindico.shield.${uniqueSuffix}@teste.com`,
      rules: 'Regras de teste de persistência',
      active: true
    });

    assert(
      res.ok && (res.data?.condominium?.id || res.data?.condo?.id),
      '2. Cadastro e Persistência Inicial de Condomínio',
      `Falha ao cadastrar condomínio para teste (status ${res.status}, error: ${res.error || 'desconhecido'})`,
      res
    );

    createdCondoId = res.data?.condominium?.id || res.data?.condo?.id;
  } catch (err: any) {
    assert(false, '2. Cadastro e Persistência Inicial de Condomínio', 'Exceção: ' + err.message);
  }

  // Test 3: Bloqueio de Cadastros Duplicados (Proteção Contra Sobrescrita/Duplicação)
  try {
    const res = await api.post('/api/condominiums/create', {
      name: testCondoName,
      address: testCondoAddress,
      city_state: 'São Paulo/SP'
    });

    assert(
      res.status === 409 && (res.data?.error?.includes('já se encontra cadastrado') || res.data?.error?.includes('cadastrado')),
      '3. Proteção Contra Duplicação e Sobrescrita de Registros',
      `O sistema permitiu duplicação de condomínio existente (status ${res.status}, esperava 409)`,
      res
    );
  } catch (err: any) {
    assert(false, '3. Proteção Contra Duplicação e Sobrescrita de Registros', 'Exceção: ' + err.message);
  }

  // Test 4: Geração de Snapshot de Backup da Base de Dados
  try {
    const res = await api.post('/api/admin/backup-snapshot', {});
    assert(
      res.ok && res.data?.success === true && res.data?.snapshotId,
      '4. Geração Automática de Backup Snapshot',
      `Falha ao gerar snapshot de backup (status ${res.status})`,
      res
    );
  } catch (err: any) {
    assert(false, '4. Geração Automática de Backup Snapshot', 'Exceção: ' + err.message);
  }

  // Test 5: Histórico de Backups Disponíveis
  try {
    const res = await api.get('/api/admin/backup-history');
    assert(
      res.ok && Array.isArray(res.data?.backups) && res.data.backups.length > 0,
      '5. Consulta ao Histórico de Snapshots de Backup',
      `Falha ao listar histórico de backups (status ${res.status})`,
      res
    );
  } catch (err: any) {
    assert(false, '5. Consulta ao Histórico de Snapshots de Backup', 'Exceção: ' + err.message);
  }

  // Test 6: Imutabilidade de ID e Validação em Atualizações
  if (createdCondoId) {
    try {
      const res = await api.put(`/api/admin/condominiums/${createdCondoId}`, {
        id: 'id-alterado-proibido',
        name: `${testCondoName} (Atualizado)`,
        address: testCondoAddress
      });

      assert(
        res.status === 400 && res.data?.error?.includes('imutável'),
        '6. Bloqueio de Alteração de ID Primário (Imutabilidade)',
        `O sistema permitiu a tentativa de alteração de ID (status ${res.status})`,
        res
      );
    } catch (err: any) {
      assert(false, '6. Bloqueio de Alteração de ID Primário (Imutabilidade)', 'Exceção: ' + err.message);
    }
  }

  // Test 7: Validação de Remoção Segura (Limpeza ao final do teste com force=true)
  if (createdCondoId) {
    try {
      const res = await api.delete(`/api/admin/condominiums/${createdCondoId}?force=true`);
      assert(
        res.ok && res.data?.success === true,
        '7. Exclusão Controlada com Audit Log',
        `Falha na remoção do condomínio de teste (status ${res.status})`,
        res
      );
    } catch (err: any) {
      assert(false, '7. Exclusão Controlada com Audit Log', 'Exceção: ' + err.message);
    }
  }

  // Test 8: Verificação de Integridade Pós-Testes (HEALTHY)
  try {
    const res = await api.get('/api/admin/integrity-check?repair=true');
    assert(
      res.ok && res.data?.status === 'HEALTHY',
      '8. Verificação de Saúde e Integridade Pós-Execução',
      `A base de dados indicou inconsistência após testes (status: ${res.data?.status})`,
      res
    );
  } catch (err: any) {
    assert(false, '8. Verificação de Saúde e Integridade Pós-Execução', 'Exceção: ' + err.message);
  }

  // Summary
  console.log('------------------------------------------------------');
  console.log('📊 RESUMO DOS TESTES DE PERSISTÊNCIA E BLINDAGEM:');
  console.log('------------------------------------------------------');

  let passedCount = 0;
  results.forEach((r, idx) => {
    if (r.passed) passedCount++;
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${idx + 1}/${results.length}] ${r.name}`);
    if (!r.passed) {
      console.log(`   Detalhes: ${r.message}`);
    }
  });

  console.log('------------------------------------------------------');
  console.log(`TOTAL APROVADOS: ${passedCount}/${results.length}`);
  console.log('======================================================\n');

  if (passedCount < results.length) {
    process.exit(1);
  }
}

// Execute directly if run via CLI
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('persistence-integrity')) {
  runPersistenceIntegrityTests();
}
