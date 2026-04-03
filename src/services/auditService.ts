import { supabase } from '../lib/supabase';
import { AuditLog } from '../types';

export const logAction = async (
  userId: string,
  condominiumId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any
) => {
  try {
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        condominium_id: condominiumId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_value: oldValue,
        new_value: newValue,
      });

    if (error) {
      console.error('Error logging action:', error);
    }
  } catch (err) {
    console.error('Audit log failed:', err);
  }
};
