/**
 * In và gửi file. expo-print mở hộp thoại in của hệ thống (Android: dịch vụ in của máy in nhiệt Bluetooth/Wi-Fi
 * hoặc "Lưu thành PDF"; iPhone: AirPrint). Gửi PDF qua Zalo bằng expo-sharing.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html });
}

export async function sharePdf(html: string, title: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  }
}
