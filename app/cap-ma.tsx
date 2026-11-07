import { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { extendUntil, LICENSE_PUBLIC_KEY, readLicense, signLicense } from '../src/features/plan/license';
import { getItem, setItem } from '../src/lib/secureStore';
import { dayToVN } from '../src/features/shop/inventory';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const KEY = 'quickpos.vendor.licenseSecret';

/**
 * Màn ẩn cho NGƯỜI BÁN (mở bằng cách bấm 7 lần vào dòng phiên bản trong Cài đặt): cấp mã kích hoạt Pro cho quán
 * đã trả tiền. Khóa bí mật chỉ lưu trong kho bảo mật của máy người bán, không nằm trong app.
 */
export default function CapMa() {
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const [shop, setShop] = useState('');
  const [years, setYears] = useState<'1' | '2' | '3'>('1');
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void getItem(KEY).then((v) => {
      if (v) {
        setSecret(v);
        setSaved(true);
      }
    });
  }, []);

  const make = async () => {
    setProblem(null);
    setCode(null);
    const s = shop.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!/^[0-9A-Z]{8}$/.test(s)) return setProblem(vi.plan.vendorBadShop);
    try {
      const until = extendUntil(null, Number(years), Date.now());
      const c = signLicense(secret.trim(), s, until);
      // Tự kiểm tra bằng khóa công khai trong app: sai khóa bí mật thì không ra mã dùng được
      if (!readLicense(c, LICENSE_PUBLIC_KEY)) return setProblem(vi.plan.vendorBadKey);
      if (!saved) {
        await setItem(KEY, secret.trim());
        setSaved(true);
      }
      setCode(c);
    } catch {
      setProblem(vi.plan.vendorBadKey);
    }
  };

  const lic = code ? readLicense(code) : null;

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={640}>
      <Txt variant="heading">{vi.plan.vendorTitle}</Txt>
      {saved ? <Txt tone="success">{`✓ ${vi.plan.vendorKeySaved}`}</Txt> : (
        <Field label={vi.plan.vendorKey} value={secret} onChangeText={setSecret} maxLength={200} testID="vendor-secret" />
      )}
      <Field label={vi.plan.vendorShop} value={shop} onChangeText={(v) => setShop(v.slice(0, 12))} maxLength={12} testID="vendor-shop" />
      <Txt variant="bodyStrong">{vi.plan.vendorYears}</Txt>
      <ChoiceGrid options={(['1', '2', '3'] as const).map((k) => ({ key: k, label: `${k} năm` }))} value={years} onChange={setYears} columns={3} testIdPrefix="vendor-years" />
      {problem ? (
        <Txt tone="danger" variant="bodyStrong">
          {problem}
        </Txt>
      ) : null}
      <Button big label={vi.plan.vendorMake} onPress={() => void make()} />
      {code && lic ? (
        <Card tone="success" style={{ gap: space.md }}>
          <Txt variant="bodyStrong">{`${vi.plan.vendorCode} · ${lic.shop} · ${dayToVN(lic.expiresOn)}`}</Txt>
          <Txt selectable>{code}</Txt>
          <Button kind="secondary" label={vi.plan.vendorShare} onPress={() => void Share.share({ message: code })} />
        </Card>
      ) : null}
    </Screen>
  );
}
