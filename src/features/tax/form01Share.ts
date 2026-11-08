/** Tạo file mẫu 01/TKN-CNKD (PDF để in, Excel để sửa) rồi mở bảng chia sẻ / in. */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { form01FileName, form01Html, form01Xlsx, type Form01Data } from './form01';

async function share(file: File, mimeType: string, UTI: string, title: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: title, UTI });
  return true;
}

export async function shareForm01Pdf(d: Form01Data, title: string): Promise<boolean> {
  // A4 ngang (điểm in 1/72 inch)
  const { uri } = await Print.printToFileAsync({ html: form01Html(d), width: 842, height: 595 });
  const named = new File(Paths.cache, form01FileName(d, 'pdf'));
  try {
    if (named.exists) named.delete();
    new File(uri).move(named);
    return share(named, 'application/pdf', 'com.adobe.pdf', title);
  } catch {
    return share(new File(uri), 'application/pdf', 'com.adobe.pdf', title);
  }
}

export async function printForm01(d: Form01Data): Promise<void> {
  await Print.printAsync({ html: form01Html(d), orientation: Print.Orientation?.landscape });
}

export async function shareForm01Xlsx(d: Form01Data, title: string): Promise<boolean> {
  const file = new File(Paths.cache, form01FileName(d, 'xlsx'));
  file.create({ overwrite: true, intermediates: true });
  file.write(form01Xlsx(d));
  return share(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet', title);
}
