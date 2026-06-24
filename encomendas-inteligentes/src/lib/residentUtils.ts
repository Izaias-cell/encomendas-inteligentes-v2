import { Morador } from '../types';

export const getResidentAddressLines = (resident: Morador | any) => {
  const lines: string[] = [];
  
  // Line 1: unit_type + unit_number
  const unitType = resident.unit_type || '';
  const unitNumber = resident.unit_number || resident.unidade || '';
  lines.push(`${unitType} ${unitNumber}`.trim());
  
  // Line 2: block (if exists)
  if (resident.block || resident.bloco) {
    lines.push(resident.block || resident.bloco);
  }
  
  // Line 3: street (if exists)
  if (resident.street) {
    lines.push(resident.street);
  }
  
  return lines;
};

export const formatResidentAddress = (resident: Morador | any) => {
  return getResidentAddressLines(resident).join(' • ');
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
