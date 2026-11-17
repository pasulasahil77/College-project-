import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfReportOptions {
  title: string;
  subtitle: string;
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  institutionName?: string;
}

export function exportTableToPDF(options: PdfReportOptions) {
  const doc = new jsPDF({
    orientation: options.headers.length > 7 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SMART ATTENDANCE SYSTEM', 14, 12);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    options.institutionName || 'Department of Computer Science • TYBSC-A-39 (Sahil Pasula | Seat: 24TCS076)',
    14,
    19
  );
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);

  // Report Title
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(options.title, 14, 38);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(options.subtitle, 14, 44);

  autoTable(doc, {
    startY: 49,
    head: [options.headers],
    body: options.rows,
    theme: 'grid',
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [15, 23, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  doc.save(options.filename);
}
