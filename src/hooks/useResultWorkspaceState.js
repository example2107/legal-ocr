import { useMemo } from 'react';

const PD_TYPE_LABELS = {
  address: 'Адреса',
  phone: 'Телефоны',
  passport: 'Паспорт РФ',
  zagranpassport: 'Загранпаспорт',
  inn: 'ИНН',
  snils: 'СНИЛС',
  card: 'Карты/счета',
  email: 'Email',
  dob: 'Даты рождения',
  birthplace: 'Место рождения',
  social_id: 'Аккаунты',
  vehicle_plate: 'Госномера ТС',
  vehicle_vin: 'VIN-номера',
  driver_license: 'Вод. удостоверения',
  military_id: 'Военные билеты',
  oms_policy: 'Полисы ОМС',
  birth_certificate: 'Св-ва о рождении',
  imei: 'IMEI устройств',
  org_link: 'Организации/ИП',
  other: 'Прочее',
};

export function useResultWorkspaceState({
  personalData,
  editingPdId,
  editingPdFragment,
  pdIdsInDoc,
} = {}) {
  const privatePersons = useMemo(
    () => personalData.persons?.filter((person) => person.category === 'private') || [],
    [personalData.persons],
  );

  const profPersons = useMemo(
    () => personalData.persons?.filter((person) => person.category === 'professional') || [],
    [personalData.persons],
  );

  const otherPD = useMemo(() => personalData.otherPD || [], [personalData.otherPD]);

  const pdTypeGroups = useMemo(() => (
    otherPD.reduce((acc, item) => {
      (acc[item.type] = acc[item.type] || []).push(item);
      return acc;
    }, {})
  ), [otherPD]);

  const hasPD = privatePersons.length > 0 || profPersons.length > 0 || otherPD.length > 0;

  const currentEditingPd = useMemo(() => {
    if (!editingPdId) return null;
    return personalData.persons?.find((person) => person.id === editingPdId)
      || personalData.otherPD?.find((item) => item.id === editingPdId)
      || null;
  }, [editingPdId, personalData.otherPD, personalData.persons]);

  const currentEditingPdFragment = useMemo(() => {
    if (!editingPdFragment) return null;
    return {
      ...editingPdFragment,
      pdItem: personalData.persons?.find((person) => person.id === editingPdFragment.id)
        || personalData.otherPD?.find((item) => item.id === editingPdFragment.id)
        || null,
    };
  }, [editingPdFragment, personalData.otherPD, personalData.persons]);

  const pdInDoc = useMemo(
    () => (id) => !pdIdsInDoc || pdIdsInDoc.has(id),
    [pdIdsInDoc],
  );

  return {
    privatePersons,
    profPersons,
    pdTypeGroups,
    pdTypeLabels: PD_TYPE_LABELS,
    hasPD,
    currentEditingPd,
    currentEditingPdFragment,
    pdInDoc,
  };
}
