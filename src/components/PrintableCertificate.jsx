
import React from 'react';
import { ShieldCheck, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

const idTypeTranslations = {
    national_id: "هوية وطنية",
    resident_id: "هوية مقيم",
    commercial_reg: "سجل تجاري"
};

const deviceTypeTranslations = {
    phone: "هاتف ذكي",
    laptop: "لابتوب",
    tablet: "تابلت",
    watch: "ساعة ذكية",
    camera: "كاميرا",
    other: "أخرى"
};

export default function PrintableCertificate({ certificate, t, showPrintButton = true, onPrint }) {
    if (!certificate) return null;

    const handlePrint = () => {
        if (onPrint) {
            onPrint();
            return;
        }

        const printContent = document.getElementById('certificate-print-area').innerHTML;
        const printWindow = window.open('', '_blank');

        printWindow.document.write(`
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>شهادة فحص الجهاز الإلكتروني - رقم ${certificate.certificateNumber}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;800&display=swap');
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: 'Cairo', sans-serif; 
                        background: white;
                        color: #1a202c;
                        line-height: 1.4;
                        font-size: 14px;
                    }
                    @page { 
                        size: A4; 
                        margin: 15mm; 
                    }
                    .certificate-page {
                        width: 210mm;
                        min-height: 297mm;
                        background: white;
                        position: relative;
                        page-break-after: always;
                    }
                    .logo-header {
                        text-align: center;
                        margin-bottom: 30px; /* Changed from 20px to 30px */
                    }
                    .logo-img {
                        width: 400px; /* Changed from 100px to 400px */
                        height: 400px; /* Changed from 100px to 400px */
                        margin: 0 auto 25px; /* Changed from 0 auto 15px */
                        display: block;
                    }
                    .cert-header {
                        text-align: left;
                        padding: 10px 0;
                        border-bottom: 1px solid #ccc;
                        font-size: 10px;
                        color: #666;
                        display: flex;
                        justify-content: space-between;
                    }
                    .main-certificate {
                        background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
                        border-radius: 20px;
                        margin: 20px 0;
                        overflow: hidden;
                        position: relative;
                    }
                    .cert-number-badge {
                        background: rgba(255,255,255,0.2);
                        color: white;
                        padding: 8px 20px;
                        border-radius: 25px;
                        display: inline-block;
                        font-weight: bold;
                        margin: 20px 0;
                    }
                    .shield-icon {
                        position: absolute;
                        top: 20px;
                        left: 30px;
                        width: 60px;
                        height: 60px;
                        background: rgba(255,255,255,0.1);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .cert-title {
                        color: white;
                        text-align: center;
                        padding: 30px 20px 20px;
                        position: relative;
                    }
                    .cert-title h1 {
                        font-size: 32px;
                        font-weight: 800;
                        margin-bottom: 8px;
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
                    }
                    .cert-title p {
                        font-size: 16px;
                        opacity: 0.9;
                        font-weight: 600;
                    }
                    .success-banner {
                        background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
                        color: white;
                        text-align: center;
                        padding: 15px;
                        font-size: 18px;
                        font-weight: 700;
                        position: relative;
                    }
                    .success-banner::before {
                        content: '✓';
                        font-size: 22px;
                        margin-left: 10px;
                    }
                    .cert-body {
                        background: white;
                        padding: 30px;
                    }
                    .info-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 15px;
                        margin-bottom: 25px;
                    }
                    .info-box {
                        background: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 8px;
                        padding: 15px;
                        text-align: center;
                    }
                    .info-label {
                        color: #64748b;
                        font-size: 12px;
                        font-weight: 600;
                        margin-bottom: 5px;
                    }
                    .info-value {
                        color: #0f172a;
                        font-size: 16px;
                        font-weight: 700;
                    }
                    .page-2 {
                        page-break-before: always;
                    }
                    .qr-section {
                        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
                        border-radius: 15px;
                        padding: 30px;
                        text-align: center;
                        margin: 20px 0;
                    }
                    .qr-box {
                        width: 120px;
                        height: 120px;
                        background: white;
                        border: 2px solid #2196f3;
                        border-radius: 8px;
                        margin: 0 auto 15px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 12px;
                        color: #2196f3;
                        font-weight: bold;
                    }
                    .features-grid {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 15px;
                        border: 2px dashed #ccc;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                    }
                    .feature-item {
                        text-align: center;
                        font-size: 12px;
                    }
                    .feature-icon {
                        font-size: 24px;
                        margin-bottom: 5px;
                        color: #2196f3;
                    }
                    .warning-box {
                        background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
                        border: 2px solid #ffc107;
                        border-radius: 10px;
                        padding: 15px;
                        text-align: center;
                        font-weight: bold;
                        color: #856404;
                        margin: 20px 0;
                    }
                    .footer-box {
                        background: #f8f9fa;
                        border: 1px solid #dee2e6;
                        border-radius: 10px;
                        padding: 20px;
                        text-align: center;
                        font-size: 11px;
                        color: #6c757d;
                        margin-top: 30px;
                    }
                </style>
            </head>
            <body>
                ${printContent}
            </body>
            </html>
        `);
        printWindow.document.close();

        // تحسين عملية الطباعة (Improved printing process)
        printWindow.addEventListener('load', () => {
            setTimeout(() => {
                printWindow.print();
                printWindow.addEventListener('afterprint', () => {
                    printWindow.close();
                });
            }, 1000); // 1-second delay to ensure content is fully rendered
        });
    };

    return (
        <div>
            {/* Print Button */}
            {showPrintButton && (
                <div className="no-print mb-4 text-center">
                    <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Printer className="w-4 h-4 ml-2" />
                        طباعة الشهادة
                    </Button>
                </div>
            )}

            {/* Certificate Content */}
            <div id="certificate-print-area">
                {/* Page 1 */}
                <div className="certificate-page">
                    <div className="cert-header">
                        <span>شهادة فحص الجهاز - {certificate.certificateNumber}</span>
                        <span>{new Date().toLocaleDateString('ar-SA')} {new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="logo-header">
                        <img src="/logo.svg" alt="Logo" className="logo-img" />
                    </div>

                    <div className="main-certificate">
                        <div className="shield-icon">
                            🛡️
                        </div>
                        <div className="cert-title">
                            <div className="cert-number-badge">
                                رقم الشهادة: {certificate.certificateNumber}
                            </div>
                            <h1>شهادة فحص الجهاز الإلكتروني</h1>
                            <p>الأمن العام - المملكة العربية السعودية</p>
                        </div>
                        <div className="success-banner">
                            تم فحص الجهاز بنجاح - الجهاز آمن وغير مسروق
                        </div>
                    </div>

                    <div className="cert-body">
                        <div className="info-grid">
                            <div className="info-box">
                                <div className="info-label">اسم المشتري</div>
                                <div className="info-value">{certificate.buyerName}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">رقم هوية المشتري</div>
                                <div className="info-value">{certificate.buyerId}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">الرقم التسلسلي للجهاز</div>
                                <div className="info-value">{certificate.serialNumber}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">نوع الجهاز</div>
                                <div className="info-value">{deviceTypeTranslations[certificate.deviceType]}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">رقم هوية البائع</div>
                                <div className="info-value">{certificate.sellerNationalId}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">رقم جوال البائع</div>
                                <div className="info-value">{certificate.sellerPhone}</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">سعر الشراء</div>
                                <div className="info-value">{certificate.purchasePrice} ريال سعودي</div>
                            </div>
                            <div className="info-box">
                                <div className="info-label">تاريخ الإصدار</div>
                                <div className="info-value">{new Date(certificate.issueDate).toLocaleDateString('ar-SA')}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Page 2 */}
                <div className="certificate-page page-2">
                    <div className="cert-header">
                        <span>شهادة فحص الجهاز - {certificate.certificateNumber}</span>
                        <span>{new Date().toLocaleDateString('ar-SA')} {new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="qr-section">
                        <div className="qr-box">
                            <div>
                                <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>QR Code</div>
                                <div>للتحقق من صحة الشهادة</div>
                            </div>
                        </div>
                        <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#2196f3' }}>امسح الكود للتحقق من صحة الشهادة</p>
                    </div>

                    <div className="features-grid">
                        <div className="feature-item">
                            <div className="feature-icon">🔒</div>
                            <div>مشفرة رقمياً</div>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">📅</div>
                            <div>صالحة لسنة واحدة</div>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">✅</div>
                            <div>معتمدة رسمياً</div>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">🌐</div>
                            <div>قابلة للتحقق أونلاين</div>
                        </div>
                    </div>

                    <div className="warning-box">
                        ⚠️ تنبيه مهم: هذه الشهادة صالحة لمدة سنة واحدة من تاريخ الإصدار
                    </div>

                    <div className="footer-box">
                        <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
                            للتحقق من صحة الشهادة، يرجى زيارة موقع الأمن العام أو الاتصال على الرقم 999
                        </div>
                        <div>
                            © 2024 الأمن العام - المملكة العربية السعودية - جميع الحقوق محفوظة
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                @media print {
                    .no-print { display: none !important; }
                    body { margin: 0; }
                }
            `}</style>
        </div>
    );
}
