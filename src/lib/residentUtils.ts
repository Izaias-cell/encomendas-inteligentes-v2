import { Morador } from '../types';

export const getResidentAddressLines = (resident: Morador | any) => {
  if (!resident) return [];
  const lines: string[] = [];
  
  // Line 1: unit_number / unidade (preserves complete string e.g. "CASA 426", "BLOCO 11/CASA 426", "TORRE 5/CASA 426")
  const rawUnit = resident.unidade || resident.unit_number || '';
  const unitType = resident.unit_type || '';
  
  let mainUnit = String(rawUnit).trim();
  if (unitType && mainUnit) {
    const unitUpper = mainUnit.toUpperCase();
    const typeUpper = String(unitType).toUpperCase();
    if (!unitUpper.includes(typeUpper)) {
      mainUnit = `${unitType} ${mainUnit}`.trim();
    }
  } else if (unitType && !mainUnit) {
    mainUnit = unitType;
  }

  if (mainUnit) {
    lines.push(mainUnit);
  }
  
  // Line 2: block (only if not already included in mainUnit)
  const block = resident.block || resident.bloco;
  if (block) {
    const blockUpper = String(block).toUpperCase();
    const mainUpper = mainUnit.toUpperCase();
    if (!mainUpper.includes(blockUpper)) {
      lines.push(blockUpper.startsWith('BLOCO') || blockUpper.startsWith('TORRE') ? block : `Bloco ${block}`);
    }
  }
  
  // Line 3: street (only if not already included in mainUnit)
  if (resident.street) {
    const streetUpper = String(resident.street).toUpperCase();
    const mainUpper = mainUnit.toUpperCase();
    if (!mainUpper.includes(streetUpper)) {
      lines.push(resident.street);
    }
  }
  
  return lines;
};

export const formatResidentAddress = (resident: Morador | any) => {
  if (!resident) return 'Unidade';
  const lines = getResidentAddressLines(resident);
  if (lines.length > 0) return lines.join(' • ');
  return resident.unidade ? String(resident.unidade).trim() : 'Unidade';
};

export const formatPackageUnit = (pkg: any) => {
  const parts: string[] = [];
  
  // Prioritize data from joined moradores if available
  const dataSource = pkg.moradores || pkg;
  
  // 1. unit_type + unit_number (fallback to raw fields on pkg)
  const unitType = dataSource.unit_type || '';
  const unitNum = dataSource.unidade || dataSource.unit_number || pkg.unit || '';
  
  if (unitNum) {
    if (unitType && unitType.toLowerCase() !== 'unidade') {
      parts.push(`${unitType} ${unitNum}`);
    } else {
      parts.push(unitNum);
    }
  } else if (unitType && unitType.toLowerCase() !== 'unidade') {
    parts.push(unitType);
  }

  // 2. block
  const block = dataSource.block || dataSource.bloco || pkg.block || pkg.bloco;
  if (block) {
    parts.push(block);
  }

  // 3. tower/lote
  const tower = dataSource.tower || pkg.tower;
  const lote = dataSource.lote || pkg.lote;
  if (tower || lote) {
    parts.push(`${tower ? 'Torre' : 'Lote'} ${tower || lote}`);
  }

  // 4. street
  const street = dataSource.street || pkg.street;
  if (street) {
    parts.push(street);
  }

  // 5. complement
  if (pkg.complement) {
    parts.push(pkg.complement);
  }

  // Fallback if everything is empty
  if (parts.length === 0) return 'Unidade';

  return parts.join(' • ');
};
