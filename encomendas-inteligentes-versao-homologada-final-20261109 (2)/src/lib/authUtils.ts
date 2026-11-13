export const normalizeRole = (role?: string) => {
  if (!role) return '';
  return role
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};
