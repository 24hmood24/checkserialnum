
import React, { useState, useEffect, useCallback } from 'react';
import { PurchaseCertificate, StolenDevice, AppUser } from '@/api/entities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { List, ShieldAlert, LogOut, Package, ShoppingCart, User, Save, Eye, EyeOff, Trash2, AlertTriangle, PlusCircle, Printer, UserCog, FileText, Plus, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { findUserByNationalId } from '@/api/functions';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import LocationSelector from './LocationSelector';
import { createPurchaseCertificate } from '@/api/functions';
import { createStolenDeviceReport } from '@/api/functions'; // Added for unified report ID generation

const normalizeNumbers = (text) => {
  if (!text) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩'; // Corrected Arabic numbers for 5 and 6
  const englishNumbers = '0123456789';
  let normalized = String(text);
  for (let i = 0; i < arabicNumbers.length; i++) {
    normalized = normalized.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
  }
  return normalized;
};

const generateCertificateNumber = async () => {
  try {
    const latestCerts = await PurchaseCertificate.list('-certificateNumber', 1);

    if (latestCerts && latestCerts.length > 0) {
      const lastNumber = parseInt(latestCerts[0].certificateNumber, 10);
      if (isNaN(lastNumber)) {
        const timestamp = Date.now();
        return timestamp.toString().slice(-10);
      }
      const newNumber = lastNumber + 1;
      return String(newNumber).padStart(10, '0');
    } else {
      return '0000000001';
    }
  } catch (error) {
    console.error("Failed to generate certificate number:", error);
    const timestamp = Date.now();
    return timestamp.toString().slice(-10);
  }
};

const detectIdType = (idNumber) => {
  if (!idNumber || idNumber.length !== 10) return null;
  const firstDigit = idNumber.charAt(0);
  if (firstDigit === '1') return 'national_id';
  if (firstDigit === '2') return 'resident_id';
  if (firstDigit === '7') return 'commercial_reg';
  return null;
};

const validateId = (id) => {
  if (!/^\d{10}$/.test(id)) {
    return false;
  }
  const detectedType = detectIdType(id);
  return detectedType !== null;
};

// Removed generateReportId as it's now handled by the backend function `createStolenDeviceReport`

const NotificationModal = ({ isOpen, onClose, title, status, children }) => {
  if (!isOpen) return null;

  const bgColor = status === 'success' ? 'bg-green-100 border-green-200 text-green-800' : status === 'danger' ? 'bg-red-100 border-red-200 text-red-800' : 'bg-blue-100 border-blue-200 text-blue-800';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className={`rounded-lg shadow-xl p-6 max-w-sm w-full ${bgColor}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className={`text-xl font-bold ${status === 'success' ? 'text-green-800' : status === 'danger' ? 'text-red-800' : 'text-blue-800'}`}>&times;</Button>
        </div>
        <div>
          {children}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose} className={`${status === 'success' ? 'bg-green-600 hover:bg-green-700' : status === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
};

// New ClosureRequestForm component
const ClosureRequestForm = ({ report, onSubmitted, onCancel, setNotification, t }) => {
  const [closureReason, setClosureReason] = useState('device_found');
  const [closureDetails, setClosureDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (closureReason === 'other' && !closureDetails.trim()) {
      setNotification({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('reasonRequiredWhenOther')}</p>
      });
      return;
    }

    setSubmitting(true);
    try {
      await StolenDevice.update(report.id, {
        status: 'pending_closure',
        closureRequestReason: closureReason,
        closureRequestDetails: closureReason === 'other' ? closureDetails.trim() : ''
      });

      onSubmitted(); // Notify parent to re-fetch data and close form

      setNotification({
        isOpen: true,
        status: 'success',
        title: t('requestSent'),
        content: <p>{t('closureRequestSubmitted')}</p>
      });

    } catch (error) {
      console.error("Error submitting closure request:", error);
      setNotification({
        isOpen: true,
        status: 'danger',
        title: t('errorTitle'),
        content: <p>{error.message || t('closureRequestError')}</p>
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-white border border-gray-200 rounded-lg shadow-inner space-y-4 mt-2">
      <h5 className="font-semibold text-gray-800 mb-3">{t('requestClosureForReport')} {report.reportId}</h5>
      <div>
        <h4 className="font-medium mb-2">{t('closureReason')}</h4>
        <RadioGroup value={closureReason} onValueChange={setClosureReason} className={`flex flex-col ${t('dir') === 'rtl' ? 'items-end' : 'items-start'} space-y-2`}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="device_found" id={`r1-${report.id}`} />
            <Label htmlFor={`r1-${report.id}`}>{t('deviceFound')}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="other" id={`r2-${report.id}`} />
            <Label htmlFor={`r2-${report.id}`}>{t('otherReason')}</Label>
          </div>
        </RadioGroup>
      </div>
      {closureReason === 'other' &&
        <div className="space-y-2">
          <Label htmlFor={`closure-details-${report.id}`}>{t('pleaseSpecify')}</Label>
          <Textarea
            id={`closure-details-${report.id}`}
            value={closureDetails}
            onChange={(e) => setClosureDetails(e.target.value)}
            placeholder={t('enterOtherReason')}
            required
            dir={t('dir')} />

        </div>
      }
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('sending') : t('submitRequest')}
        </Button>
      </div>
    </form>
  );
};


// New printCertificateHtml component
const printCertificateHtml = (certificate, t, userType) => {
  const isAdmin = userType === 'admin';

  const maskIdNumber = (id) => {
    if (!id || typeof id !== 'string' || id.length < 5) return id;
    return `${id.slice(0, 2)}******${id.slice(-2)}`;
  };

  const idTypeTranslations = {
    national_id: t('idNational'),
    resident_id: t('idResident'),
    commercial_reg: t('idCommercial')
  };

  const deviceTranslations = {
    phone: t('devicePhone'),
    laptop: t('deviceLaptop'),
    tablet: t('deviceTablet'),
    watch: t('deviceWatch'),
    camera: t('deviceCamera'),
    other: t('deviceOther')
  };

  try {
    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      throw new Error('Unable to open print window - popup blocked');
    }

    printWindow.document.write(`
            <!DOCTYPE html>
            <html dir="${t('dir')}" lang="${t('lang')}">
            <head>
                <meta charset="UTF-8">
                <title>${t('certificateOfPurchase')} - ${t('certificateNumber')} ${certificate.certificateNumber}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
                    
                    @page { 
                        size: A4; 
                        margin: 10mm;
                    }

                    * { 
                        box-sizing: border-box; 
                        margin: 0;
                        padding: 0;
                    }

                    html, body {
                        width: 100%;
                        height: 100vh;
                        overflow: hidden;
                    }

                    body { 
                        font-family: 'Cairo', sans-serif; 
                        background: white;
                        color: #1a202c;
                        line-height: 1.3;
                        padding: 0;
                        margin: 0;
                    }
                    
                    .certificate-wrapper {
                        border: 1px solid #ddd;
                        padding: 8mm;
                        width: 100%;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                        page-break-after: avoid;
                        overflow: hidden;
                    }

                    .logo-header {
                        text-align: center;
                        margin-bottom: 6px;
                    }
                    .logo-img {
                        width: 80px;
                        height: 80px;
                    }

                    .header {
                        text-align: center;
                        margin-bottom: 8px;
                    }
                    .header h1 {
                        font-size: 18px;
                        font-weight: 700;
                        color: #1e3a8a;
                        margin-bottom: 2px;
                    }
                    .header p {
                        font-size: 12px;
                        color: #4b5563;
                    }

                    main {
                        flex-grow: 1;
                        display: flex;
                        flex-direction: column;
                    }

                    .cert-number {
                        background: #1e3a8a;
                        color: white;
                        padding: 4px 10px;
                        border-radius: 4px;
                        text-align: center;
                        font-size: 12px;
                        font-weight: 700;
                        margin: 0 auto 8px auto;
                        width: fit-content;
                    }

                    .confirmation-box {
                        background: #f0fdf4;
                        border: 1px solid #22c55e;
                        border-radius: 4px;
                        padding: 6px;
                        text-align: center;
                        font-size: 11px;
                        font-weight: 700;
                        color: #166534;
                        margin-bottom: 8px;
                    }

                    .section-title {
                        font-size: 13px;
                        font-weight: 700;
                        color: #1e3a8a;
                        border-bottom: 2px solid #1e3a8a;
                        padding-bottom: 2px;
                        margin-top: 8px;
                        margin-bottom: 6px;
                    }

                    .info-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 4px;
                        margin-bottom: 6px;
                    }

                    .info-item {
                        background: #f8fafc;
                        border: 1px solid #e5e7eb;
                        border-radius: 3px;
                        padding: 4px;
                    }

                    .info-label {
                        color: #6b7280;
                        font-size: 9px;
                        margin-bottom: 1px;
                    }

                    .info-value {
                        color: #111827;
                        font-size: 10px;
                        font-weight: 600;
                        word-wrap: break-word;
                    }

                    footer {
                        margin-top: auto;
                        padding-top: 6px;
                        border-top: 1px solid #e5e7eb;
                        text-align: center;
                        font-size: 8px;
                        color: #6b7280;
                    }

                    @media print {
                        html, body {
                            height: auto !important;
                            overflow: visible !important;
                        }
                        
                        body { 
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        
                        .certificate-wrapper {
                            border: 1px solid #ddd;
                            padding: 8mm;
                            height: auto;
                            min-height: 0;
                            page-break-after: avoid;
                            page-break-inside: avoid;
                        }
                        
                        .info-grid {
                            page-break-inside: avoid;
                        }
                        
                        .section-title {
                            page-break-after: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="certificate-wrapper">
                    <header>
                        <div class="logo-header">
                          <img src="/logo.svg" alt="Logo" class="logo-img">
                        </div>
                        <div class="header">
                            <h1>${t('certificateOfPurchase')}</h1>
                            <p>${t('publicSecurity')}</p>
                        </div>
                    </header>

                    <main>
                        <div class="cert-number">
                            ${t('certificateNumber')}: ${certificate.certificateNumber}
                        </div>
                        <div class="confirmation-box">
                            ✅ ${t('certificateDisclaimer')}
                        </div>
                        
                        <div class="section-title">${t('deviceInfo')}</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <div class="info-label">${t('serialNumberLabel')}</div>
                                <div class="info-value">${certificate.serialNumber}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">${t('deviceType')}</div>
                                <div class="info-value">${deviceTranslations[certificate.deviceType] || certificate.deviceType}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">${t('purchasePrice')}</div>
                                <div class="info-value">${certificate.purchasePrice ? certificate.purchasePrice + ' ' + t('currency') : '-'}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">${t('issueDate')}</div>
                                <div class="info-value">${new Date(certificate.issueDate).toLocaleDateString(t('locale'))}</div>
                            </div>
                        </div>

                        <div class="section-title">${t('buyerInfo')}</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <div class="info-label">${t('buyerName')}</div>
                                <div class="info-value">${certificate.buyerName}</div>
                            </div>
                             <div class="info-item">
                                <div class="info-label">${t('idType')}</div>
                                <div class="info-value">${idTypeTranslations[certificate.buyerIdType] || certificate.buyerIdType}</div>
                            </div>
                            <div class="info-item" style="grid-column: span 2;">
                                <div class="info-label">${t('idNumber')}</div>
                                <div class="info-value">${isAdmin ? certificate.buyerId : maskIdNumber(certificate.buyerId)}</div>
                            </div>
                        </div>

                        <div class="section-title">${t('sellerInfo')}</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <div class="info-label">${t('idType')}</div>
                                <div class="info-value">${certificate.sellerIdType ? idTypeTranslations[certificate.sellerIdType] || certificate.sellerIdType : '-'}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">${t('idNumber')}</div>
                                <div class="info-value">${isAdmin ? certificate.sellerNationalId : maskIdNumber(certificate.sellerNationalId)}</div>
                            </div>
                            <div class="info-item" style="grid-column: span 2;">
                                <div class="info-label">${t('phoneNumber')}</div>
                                <div class="info-value">${certificate.sellerPhone || '-'}</div>
                            </div>
                        </div>
                    </main>

                    <footer>
                        <div>${t('publicSecurity')} - ${t('rightsReserved')} 2024</div>
                        <div>${t('certificateIssueConfirmation')} ${new Date().toLocaleDateString(t('locale'))} ${new Date().toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' })} ${t('atTime')}</div>
                    </footer>
                </div>
            </body>
            </html>
        `);

    printWindow.document.close();

    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        try {
          printWindow.print();
          printWindow.addEventListener('afterprint', () => {
            printWindow.close();
          });
        } catch (printError) {
          console.error('Print failed:', printError);
          printWindow.close();
        }
      }, 500);
    });

    printWindow.addEventListener('error', () => {
      console.error('Print window failed to load');
      printWindow.close();
    });

  } catch (error) {
    console.error('Failed to create print window in printCertificateHtml:', error);
    throw error; // Re-throw so the caller can catch and notify
  }
};


// New SellDeviceModal component - to be defined
const SellDeviceModal = ({ isOpen, onClose, onSubmit, device, sellFormData, setSellFormData, loading, t }) => {
  if (!isOpen || !device) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSellFormData((prev) => ({ ...prev, [name]: value }));
  };

  const deviceTypeOptions = [
    { value: 'phone', label: t('devicePhone') },
    { value: 'laptop', label: t('deviceLaptop') },
    { value: 'tablet', label: t('deviceTablet') },
    { value: 'watch', label: t('deviceWatch') },
    { value: 'camera', label: t('deviceCamera') },
    { value: 'other', label: t('deviceOther') }
  ];


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-background px-10 py-6 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 sm:rounded-lg sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-right leading-none tracking-tight">{t('sellDeviceTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 py-4">
          <p className="text-right text-sm">{t('sellingDeviceInfo')}</p>
          <p className="text-right text-sm text-gray-700"><strong>{t('serialNumberLabel')}:</strong> <span dir="ltr">{device.serialNumber}</span></p>
          <p className="text-right text-sm text-gray-700"><strong>{t('originalDeviceType')}:</strong> {t(`device${device.deviceType.charAt(0).toUpperCase() + device.deviceType.slice(1)}`)}</p>

          <div>
            <Label htmlFor="buyerId" className="text-gray-700 mb-2 text-sm font-medium text-right peer-disabled:cursor-not-allowed peer-disabled:opacity-70 block">{t('buyerIdLabel')}</Label> {/* Updated translation key */}
            <Input
              id="buyerId"
              name="buyerId"
              value={sellFormData.buyerId}
              onChange={(e) => setSellFormData((prev) => ({ ...prev, buyerId: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) }))} // Added sanitization
              placeholder={t('enterBuyerId')}
              required
              dir="ltr"
              maxLength={10}
              minLength={10}
              className="bg-white" />

          </div>
          <div>
            <Label htmlFor="purchasePrice" className="text-gray-700 mb-2 text-sm font-medium text-right peer-disabled:cursor-not-allowed peer-disabled:opacity-70 block">{t('salePrice')}</Label> {/* Updated translation key */}
            <Input
              id="purchasePrice"
              name="purchasePrice"
              type="text" // Changed to text to allow for more flexible input sanitization
              value={sellFormData.purchasePrice}
              onChange={(e) => setSellFormData((prev) => ({ ...prev, purchasePrice: e.target.value.replace(/[^0-9.]/g, '') }))} // Added sanitization
              placeholder={t('enterPurchasePrice')}
              required
              className="text-left bg-white"
              dir="ltr" />

          </div>
          <div>
            <Label htmlFor="deviceTypeConfirmation" className="text-gray-700 mb-2 text-sm font-medium text-right peer-disabled:cursor-not-allowed peer-disabled:opacity-70 block">{t('confirmDeviceType')}</Label>
            <Select onValueChange={(value) => setSellFormData((prev) => ({ ...prev, deviceType: value }))} value={sellFormData.deviceType} required>
              <SelectTrigger id="deviceTypeConfirmation" className="w-full bg-white">
                <SelectValue placeholder={t('selectDeviceType')} />
              </SelectTrigger>
              <SelectContent>
                {deviceTypeOptions.map((option) =>
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                )}
              </SelectContent>
            </Select>
            {sellFormData.deviceType && sellFormData.deviceType !== device.deviceType &&
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t('deviceTypeMismatchWarning')}</p>
            }
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={loading || !sellFormData.deviceType || sellFormData.deviceType !== device.deviceType}>
              {loading ? t('sellingDevice') : t('confirmSale')} {/* Updated loading text */}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};


export default function UserDashboard({ t, user, onLogout, setNotification, userType = 'user' }) {
  const [activeTab, setActiveTab] = useState('devices');
  const [userDevices, setUserDevices] = useState([]);
  const [userReports, setUserReports] = useState([]);
  // Refactored state for selling
  const [showSellModal, setShowSellModal] = useState(false);
  const [deviceToSell, setDeviceToSell] = useState(null);
  const [sellFormData, setSellFormData] = useState({ buyerId: '', purchasePrice: '', deviceType: '' });
  const [sellLoading, setSellLoading] = useState(false);
  const [refreshData, setRefreshData] = useState(0); // State to trigger refresh

  const [showReportFormDeviceId, setShowReportFormDeviceId] = useState(null);
  const [loading, setLoading] = useState(true); // Initial loading for the whole dashboard
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notificationState, setNotificationState] = useState({ isOpen: false, title: '', content: null, status: 'default' }); // Renamed local notification state to avoid prop conflict

  const [showAddDeviceForm, setShowAddDeviceForm] = useState(false);
  const [addDeviceFormData, setAddDeviceFormData] = useState({ serialNumber: '', deviceType: '' });
  const [addDeviceLoading, setAddDeviceLoading] = useState(false);

  // Removed showClosureRequestModal, closureRequestReport, closureReason, closureDetails
  // Replaced by activeClosureForm and passed to ClosureRequestForm component
  const [activeClosureForm, setActiveClosureForm] = useState(null);

  const [reportFormData, setReportFormData] = useState({ // State for report form data
    reportDate: '', // This is for the theft date, name will be theftDate in entity
    location: '',
    theftDetails: ''
  });

  const [userInfoData, setUserInfoData] = useState({
    full_name: '',
    phone_number: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  });
  const [editMode, setEditMode] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // Removed handleSellFormChange since selling is now modal based

  const handleReportFormChange = (e) => {
    const { name, value } = e.target;
    setReportFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Helper function to format date safely
  const formatDate = (dateString) => {
    if (!dateString) return t('notSpecified'); // Use translation key
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return t('notSpecified');
      return date.toLocaleDateString(t('locale'));
    } catch (error) {
      return t('notSpecified');
    }
  };

  const fetchUserDevices = useCallback(async () => {
    if (!user || !user.national_id) {
      setUserDevices([]); // Clear devices if user is not valid
      return;
    }
    try {
      const devices = await PurchaseCertificate.filter({ buyerId: user.national_id, status: 'active' }, '-created_date');
      setUserDevices(devices || []);
    } catch (err) {
      console.error('Error fetching user devices:', err);
      setError(t('fetchError'));
    }
  }, [user, t]);

  const fetchUserReports = useCallback(async () => {
    if (!user || !user.national_id) {
      setUserReports([]); // Clear reports if user is not valid
      return;
    }
    try {
      const reports = await StolenDevice.filter({ reporterNationalId: user.national_id });
      setUserReports(reports || []);
    } catch (err) {
      console.error('Error fetching user reports:', err);
      setError(t('fetchError'));
    }
  }, [user, t]);

  useEffect(() => {
    // Only set initial loading state for the whole dashboard if it's the very first load
    // Subsequent loads due to refreshData or tab changes will be handled by specific loaders if needed
    if (user && user.national_id) {
      setLoading(true);
      Promise.all([
        fetchUserDevices(),
        fetchUserReports()
      ]).finally(() => {
        setLoading(false);
        setError(''); // Clear error if successful
      });
    } else {
      setLoading(false); // If no user, not loading.
    }
  }, [user, refreshData, fetchUserDevices, fetchUserReports]); // Add refreshData as a dependency

  // This function will trigger a re-fetch of all user-related data
  const handleDataUpdate = () => {
    setRefreshData((prev) => prev + 1); // Increment to trigger re-fetch
  };

  // New selling flow functions
  const handleOpenSellModal = (device) => {
    setDeviceToSell(device);
    // User must now manually select the device type for confirmation.
    setSellFormData({ buyerId: '', purchasePrice: '', deviceType: '' });
    setShowSellModal(true);
  };

  const handleSellDevice = async (e) => {
    e.preventDefault();
    setNotificationState({ isOpen: false, title: '', content: null, status: 'default' }); // Clear previous notification

    if (!deviceToSell) {
      setNotificationState({ isOpen: true, status: 'danger', title: t('sellDeviceError'), content: <p>{t('deviceNotFoundError')}</p> });
      return;
    }

    const buyerId = normalizeNumbers(sellFormData.buyerId);
    const purchasePrice = parseFloat(sellFormData.purchasePrice);
    const confirmedDeviceType = sellFormData.deviceType; // User's selected device type for confirmation

    // Validations
    if (!buyerId || isNaN(purchasePrice) || purchasePrice <= 0 || !confirmedDeviceType) {
      setNotificationState({ isOpen: true, status: 'danger', title: t('validationErrorTitle'), content: <p>{t('allFieldsRequired')}</p> });
      return;
    }

    if (buyerId.length !== 10) {
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('invalidBuyerIdLength')}</p>
      });
      return;
    }

    if (!validateId(buyerId)) {
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('invalidIdFormat')}</p>
      });
      return;
    }

    if (buyerId === user.national_id) {
      setNotificationState({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('cannotSellToYourself')}</p>, status: 'danger' });
      return;
    }
    if (confirmedDeviceType !== deviceToSell.deviceType) {
      setNotificationState({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('deviceTypeMustMatch')}</p>, status: 'danger' });
      return;
    }

    setSellLoading(true);
    try {
      const { data: buyerCheck } = await findUserByNationalId({ nationalId: buyerId });

      if (!buyerCheck || !buyerCheck.exists || !buyerCheck.data || !buyerCheck.data.user) {
        setNotificationState({ isOpen: true, title: t('sellDeviceError'), content: <p>{t('buyerAccountNotFound')}</p>, status: 'danger' });
        setSellLoading(false);
        return;
      }

      // Correctly access the buyer's data from the nested object
      const buyerData = buyerCheck.data.user;

      // FIX: Generate a new certificate number for the new certificate
      const newCertNumber = await generateCertificateNumber();

      const certificateData = {
        // FIX: Added the newly generated certificate number
        certificateNumber: newCertNumber,
        serialNumber: deviceToSell.serialNumber,
        deviceType: confirmedDeviceType,
        purchasePrice: purchasePrice,

        // Sender's (current owner) details
        sellerIdType: detectIdType(user.national_id),
        sellerNationalId: user.national_id,
        sellerPhone: user.phone_number,

        // Receiver's (new owner) details - FINAL FIX
        buyerIdType: detectIdType(buyerId),
        buyerId: buyerId,
        buyerName: buyerData.full_name, // FINAL FIX: Access directly from buyerData
        buyerNameAtSale: buyerData.full_name, // FINAL FIX: Access directly from buyerData

        issueDate: new Date().toISOString().split('T')[0],
        originalCertificateId: deviceToSell.id,
      };

      // Use the new backend function
      const { data: newCertificate } = await createPurchaseCertificate(certificateData);

      setNotificationState({
        isOpen: true,
        status: 'success',
        title: t('deviceSoldSuccess'),
        content: (
          <div>
            <p>{t('deviceSoldSuccess')}</p>
            <p className="font-bold text-blue-600 mt-2">{newCertificate.certificateNumber}</p>
            <Button onClick={() => printCertificate(newCertificate)} className="mt-4 w-full">
              <Printer className="ml-2 h-4 w-4" /> {t('printCertificate')}
            </Button>
          </div>
        )
      });
      setShowSellModal(false);
      setDeviceToSell(null); // Reset device to sell
      setSellFormData({ buyerId: '', purchasePrice: '', deviceType: '' }); // Reset form data
      handleDataUpdate(); // Trigger data refresh

    } catch (error) {
      console.error('Sell device error:', error);
      const errorMessage = error.response?.data?.details || error.message || t('sellDeviceError');
      setNotificationState({ isOpen: true, title: t('sellDeviceError'), content: <p>{errorMessage}</p>, status: 'danger' });
    } finally {
      setSellLoading(false);
    }
  };

  const handleReportSubmit = async (e, device) => {
    e.preventDefault();
    setLoading(true);
    setNotificationState({ isOpen: false, title: '', content: null, status: 'default' });

    const { reportDate, location, theftDetails } = reportFormData; // Use state

    if (!reportDate || !location?.trim()) {
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('allFieldsRequired')}</p>
      });
      setLoading(false);
      return;
    }

    const locationParts = location.split(' - ');
    // Robust validation: check length and ensure no empty parts
    if (locationParts.length !== 3 || locationParts.some(part => part.trim() === '')) {
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('invalidLocationSelection')}</p>
      });
      setLoading(false);
      return;
    }

    try {
      // reportId generation is now handled by the backend function createStolenDeviceReport
      const reporterIdType = detectIdType(user.national_id);

      const reportData = {
        serialNumber: device.serialNumber,
        deviceType: device.deviceType,
        reporterIdType: reporterIdType,
        reporterNationalId: user.national_id,
        reporterPhone: user.phone_number,
        theftDate: reportDate, // This is the date of theft
        location: location.trim(),
        theftDetails: theftDetails?.trim() || '',
        status: 'active'
      };

      // Use the new backend function to create the report
      const { data: newReport } = await createStolenDeviceReport(reportData);
      const generatedReportId = newReport.reportId; // Get the generated ID from the response

      // Update certificate status to 'stolen' as per changes outline
      const { data: updatedCert } = await PurchaseCertificate.update(device.id, { status: 'stolen' });

      handleDataUpdate(); // Trigger data refresh

      setShowReportFormDeviceId(null);
      setReportFormData({ reportDate: '', location: '', theftDetails: '' }); // Reset form data

      setActiveTab('reports');

      setNotificationState({
        isOpen: true,
        status: 'success',
        title: t('theftReportSuccess'),
        content:
          <div>
            <p>{t('theftReportSuccess')}</p>
            <p className="font-bold text-blue-600 mt-2 text-lg">{generatedReportId}</p> {/* Display the generated ID */}
            <div className="mt-3">
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(generatedReportId); // Copy the generated ID
                  setNotificationState((prev) => ({ ...prev, isOpen: false }));
                }}
                variant="outline"
                size="sm"
                className="w-full">

                {t('copyReportId')}
              </Button>
            </div>
          </div>

      });

    } catch (error) {
      console.error("Error reporting theft:", error);
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('reportTheftError'),
        content: <p>{error.message || t('reportTheftError')}</p>
      });
    } finally {
      setLoading(false);
    }
  };

  const validatePassword = (password) => {
    return password.length >= 8;
  };

  const handleSaveUserInfo = async (e) => {
    e.preventDefault();
    setSaveLoading(true);

    let updates = {
      full_name: userInfoData.full_name,
      phone_number: userInfoData.phone_number
    };

    try {
      if (userInfoData.newPassword) {
        if (!validatePassword(userInfoData.newPassword)) {
          setNotificationState({
            isOpen: true,
            status: 'danger',
            title: t('validationErrorTitle'),
            content: <p>{t('invalidPasswordError')}</p>
          });
          setSaveLoading(false);
          return;
        }
        if (userInfoData.newPassword !== userInfoData.confirmNewPassword) {
          setNotificationState({
            isOpen: true,
            status: 'danger',
            title: t('validationErrorTitle'),
            content: <p>{t('passwordMismatchError')}</p>
          });
          setSaveLoading(false);
          return;
        }

        updates.currentPassword = userInfoData.currentPassword;
        updates.newPassword = userInfoData.newPassword;
      }

      // CORRECTED: Use AppUser entity to update
      await AppUser.update(user.id, updates);

      setNotificationState({
        isOpen: true,
        status: 'success',
        title: t('updateSuccessTitle'),
        content: <p>{t('userInfoUpdated')}</p>
      });
      setEditMode(false);
      setUserInfoData((prev) => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      }));
      // User info update also potentially changes the `user` prop itself if `full_name` or `phone_number` change.
      // However, `fetchUserData` (now `handleDataUpdate`) only refreshes devices/reports.
      // A full user object refresh might be needed, or ensure the `user` prop is updated by the parent.
      // For now, `handleDataUpdate` is sufficient for device/report context.
      handleDataUpdate();
    } catch (error) {
      console.error("Update user info error:", error);
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('updateErrorTitle'),
        content: <p>{error.message || t('updateError')}</p>
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleAddDeviceSubmit = async (e) => {
    e.preventDefault();
    setAddDeviceLoading(true);
    setNotificationState({ isOpen: false, title: '', content: null, status: 'default' });

    try {
      const serialNumber = normalizeNumbers(addDeviceFormData.serialNumber);
      const deviceType = addDeviceFormData.deviceType;

      const stolenDevices = await StolenDevice.filter({ serialNumber: serialNumber, status: 'active' });
      if (stolenDevices.length > 0) {
        setNotificationState({
          isOpen: true,
          status: 'danger',
          title: t('addDevice'),
          content: <p>{t('deviceReportedStolen')}</p>
        });
        setAddDeviceLoading(false);
        return;
      }

      const existingActiveCerts = await PurchaseCertificate.filter({ serialNumber: serialNumber, status: 'active' });
      if (existingActiveCerts.length > 0) {
        setNotificationState({
          isOpen: true,
          status: 'danger',
          title: t('addDevice'),
          content: <p>{t('deviceAlreadyRegisteredActive')}</p>
        });
        setAddDeviceLoading(false);
        return;
      }

      const newCertNumber = await generateCertificateNumber();

      const buyerIdType = detectIdType(user.national_id);

      const newCertificate = {
        certificateNumber: newCertNumber,
        buyerIdType: buyerIdType,
        buyerId: user.national_id,
        buyerName: user.full_name,
        deviceType: deviceType,
        serialNumber: serialNumber,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'active'
      };

      await PurchaseCertificate.create(newCertificate);

      setNotificationState({
        isOpen: true,
        status: 'success',
        title: t('addDevice'),
        content: <p>{t('deviceAddedSuccess')}</p>
      });
      setShowAddDeviceForm(false);
      setAddDeviceFormData({ serialNumber: '', deviceType: '' });
      handleDataUpdate(); // Trigger data refresh
    } catch (error) {
      console.error("Error adding device:", error);
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('addDevice'),
        content: <p>{error.message || t('reportErrorTitle')}</p>
      });
    } finally {
      setAddDeviceLoading(false);
    }
  };

  const printCertificate = (certificate) => {
    // We pass 'ar' for lang because the certificate is always in Arabic
    try {
      printCertificateHtml(certificate, (key) => t(key, 'ar'), userType);
    } catch (error) {
      console.error('Failed to print certificate:', error);
      setNotificationState({
        isOpen: true,
        status: 'danger',
        title: t('printErrorTitle'),
        content: <p>{error.message || t('printErrorMessage')}</p>
      });
    }
  };


  // NEW FUNCTIONS FOR TOGGLING FORMS
  // Modified handleToggleSellForm to call handleOpenSellModal
  const handleToggleSellForm = (device) => {
    if (showSellModal && deviceToSell?.id === device.id) { // If modal for this device is already open, close it
      setShowSellModal(false);
      setDeviceToSell(null);
      setSellFormData({ buyerId: '', purchasePrice: '', deviceType: '' });
    } else { // Otherwise, open it for this device
      handleOpenSellModal(device);
    }
    // Ensure other forms are closed
    setShowReportFormDeviceId(null);
    setActiveClosureForm(null);
    setReportFormData({ reportDate: '', location: '', theftDetails: '' });
  };

  const handleToggleReportForm = (deviceId) => {
    setShowReportFormDeviceId((prevId) => prevId === deviceId ? null : deviceId);
    setShowSellModal(false); // Close sell modal
    setDeviceToSell(null);
    setActiveClosureForm(null); // Close closure form
    if (showReportFormDeviceId !== deviceId) { // If opening a new form or closing the current one
      setReportFormData({ reportDate: '', location: '', theftDetails: '' });
    }
    setSellFormData({ buyerId: '', purchasePrice: '', deviceType: '' }); // Reset sell form too
  };

  const handleToggleClosureForm = (reportId) => {
    setActiveClosureForm((prevId) => prevId === reportId ? null : reportId);
    setShowSellModal(false); // Close sell modal
    setDeviceToSell(null);
    setShowReportFormDeviceId(null); // Close other form
  };


  const renderDevices = () => {
    // The initial loading/no devices check is now done outside this function
    return (
      <div className="space-y-4">
        {userDevices.map((device) =>
          <div key={device.id} className="border rounded-lg bg-white shadow-sm transition-all hover:shadow-md">
            <div className="p-4 flex justify-between items-start gap-4">
              <div className="flex-grow">
                <p className="font-bold text-gray-800">{t(`device${device.deviceType.charAt(0).toUpperCase() + device.deviceType.slice(1)}`)}</p>
                <p className="text-sm text-gray-600 font-mono" dir="ltr">{device.serialNumber}</p>
                <span className={`mt-2 inline-block px-2 py-1 rounded-full text-xs font-semibold ${device.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`
                }>
                  {t(`status${device.status.charAt(0).toUpperCase() + device.status.slice(1)}`)}
                </span>
              </div>

              <div className="flex-shrink-0">
                {/* Buttons for larger screens */}
                <div className="hidden md:flex gap-2">
                  <Button size="sm" onClick={() => printCertificate(device)} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Printer className="w-4 h-4 ml-1" /> {t('printCertificate')}
                  </Button>
                  <Button size="sm" onClick={() => handleToggleSellForm(device)}> {/* Changed to call handleToggleSellForm with device object */}
                    <ShoppingCart className="w-4 h-4 ml-2" />
                    {t('sellDevice')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleToggleReportForm(device.id)}>
                    <ShieldAlert className="w-4 h-4 ml-1" />
                    {t('reportTheft')}
                  </Button>
                </div>
                {/* Dropdown for smaller screens */}
                <div className="md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => printCertificate(device)}>
                        <Printer className="w-4 h-4 ml-2" />
                        <span>{t('printCertificate')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleToggleSellForm(device)}> {/* Changed to call handleToggleSellForm with device object */}
                        <ShoppingCart className="w-4 h-4 ml-2" />
                        <span>{t('sellDevice')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleToggleReportForm(device.id)} className="text-red-600 focus:text-red-600">
                        <ShieldAlert className="w-4 h-4 ml-2" />
                        <span>{t('reportTheft')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
            <AnimatePresence>
              {showReportFormDeviceId === device.id &&
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="bg-red-50 p-4 rounded-b-lg mt-0 border-t border-red-200">

                  <h4 className="font-bold text-red-800 mb-4">{t('reportTheftTitle')}</h4>
                  <form onSubmit={(e) => handleReportSubmit(e, device)} className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('reportDate')} <span className="text-red-500">*</span></label>
                        <Input name="reportDate" type="date" value={reportFormData.reportDate} onChange={handleReportFormChange} required className="bg-white" />
                      </div>
                      <div>
                        {/* Empty for spacing */}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('theftLocation')}</label>
                      <LocationSelector
                        value={reportFormData.location}
                        onChange={(loc) => setReportFormData((prev) => ({ ...prev, location: loc }))}
                        required={true}
                        lang={t('lang')} />

                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('theftDetails')}</label>
                      <Textarea name="theftDetails" value={reportFormData.theftDetails} onChange={handleReportFormChange} placeholder={t('theftDetails')} className="bg-white" />
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" disabled={loading} variant="destructive" className="flex-1">
                        {loading ? t('sending') : t('submitReportButton')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => handleToggleReportForm(device.id)} className="flex-1">
                        {t('cancel')}
                      </Button>
                    </div>
                  </form>
                </motion.div>
              }
            </AnimatePresence>
          </div>
        )}
      </div>);

  };

  const renderReports = () => {
    if (loading && userReports.length === 0) {
      return <div className="text-center p-10">{t('loadingData')}</div>;
    }

    if (userReports.length === 0) {
      return <div className="text-center p-10">{t('noReportsFound')}</div>;
    }

    return (
      <div className="space-y-4">
        {userReports.map((report) =>
          <div key={report.id} className="border rounded-lg p-4 bg-gray-50 flex flex-wrap justify-between items-start gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <span className="font-bold">{t('reportId')}: {report.reportId}</span>
              </div>
              <p className="text-sm text-gray-600">{t('serialNumberLabel')}: <span className="font-mono">{report.serialNumber}</span></p>
              <p className="text-sm text-gray-600">{t('deviceType')}: {t(`device${report.deviceType.charAt(0).toUpperCase() + report.deviceType.slice(1)}`)}</p>
              <p className="text-sm text-gray-600">{t('reportRegistrationDate')}: {formatDate(report.created_date)}</p>
              <p className="text-sm text-gray-600">{t('theftDate')}: {formatDate(report.theftDate)}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${report.status === 'active' ? 'bg-red-100 text-red-800' :
                  report.status === 'pending_closure' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'}`
              }>
                {t(`status${report.status.charAt(0).toUpperCase() + report.status.slice(1)}`)}
              </span>
              {report.status === 'active' &&
                <Button size="sm" variant="outline" onClick={() => handleToggleClosureForm(report.id)}>
                  {t('requestClosure')}
                </Button>
              }
              <AnimatePresence>
                {activeClosureForm === report.id &&
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="w-full">
                    <ClosureRequestForm
                      report={report}
                      onSubmitted={() => { setActiveClosureForm(null); handleDataUpdate(); }} // Use handleDataUpdate here
                      onCancel={() => setActiveClosureForm(null)}
                      setNotification={setNotificationState}
                      t={t} />

                  </motion.div>
                }
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>);

  };


  if (!user) {
    return (
      <div className="text-center p-10 text-white">
        <p>{t('loadingData')}</p>
      </div>);

  }

  // Refined initial loading check
  if (loading && userDevices.length === 0 && userReports.length === 0) {
    return <div className="text-center p-10 text-white">{t('loadingData')}</div>;
  }

  return (
    <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl p-6 max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-800 mb-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <UserCog className="w-6 h-6 text-blue-600" />
            {t('myAccount')} - {user.full_name}
          </div>
          <Button onClick={onLogout} variant="outline" size="sm" className="text-red-600 border-red-600 hover:bg-red-50">
            <LogOut className="w-4 h-4 ml-2" />
            {t('logout')}
          </Button>
        </CardTitle>
        <div className="flex border-b">
          <button onClick={() => setActiveTab('devices')} className={`flex-1 py-2 px-4 font-semibold ${activeTab === 'devices' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>{t('myDevices')}</button>
          <button onClick={() => setActiveTab('reports')} className={`flex-1 py-2 px-4 font-semibold ${activeTab === 'reports' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>{t('myReports')}</button>
          <button onClick={() => setActiveTab('profile')} className={`flex-1 py-2 px-4 font-semibold ${activeTab === 'profile' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>{t('myProfile')}</button>
        </div>
      </CardHeader>
      <CardContent>
        {error &&
          <div className="bg-red-100 text-red-800 p-3 rounded-md mb-4 border border-red-200">
            <p>{error}</p>
          </div>
        }

        {activeTab === 'devices' &&
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">{t('devicesYouOwn')}</h3>
              <Button onClick={() => setShowAddDeviceForm(!showAddDeviceForm)} variant="outline" className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4" /> {t('addDevice')}
              </Button>
            </div>

            {showAddDeviceForm &&
              <Card className="my-4 p-4 bg-gray-50 border-blue-200">
                <form onSubmit={handleAddDeviceSubmit} className="space-y-3">
                  <h4 className="font-semibold text-blue-800">{t('addNewDeviceTitle')}</h4>
                  <div>
                    <label className="text-sm font-medium text-gray-700">{t('serialNumber')}</label>
                    <Input
                      name="serialNumber"
                      placeholder={t('serialNumber')}
                      required
                      value={addDeviceFormData.serialNumber}
                      onChange={(e) => setAddDeviceFormData({ ...addDeviceFormData, serialNumber: e.target.value })}
                      dir="ltr"
                      className="text-left" />

                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t('selectDeviceType')}</label>
                    <Select
                      onValueChange={(value) => setAddDeviceFormData({ ...addDeviceFormData, deviceType: value })}
                      required
                      value={addDeviceFormData.deviceType}>

                      <SelectTrigger><SelectValue placeholder={t('selectDeviceType')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone">{t('devicePhone')}</SelectItem>
                        <SelectItem value="laptop">{t('deviceLaptop')}</SelectItem>
                        <SelectItem value="tablet">{t('deviceTablet')}</SelectItem>
                        <SelectItem value="watch">{t('deviceWatch')}</SelectItem>
                        <SelectItem value="camera">{t('deviceCamera')}</SelectItem>
                        <SelectItem value="other">{t('deviceOther')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={addDeviceLoading} className="bg-blue-600 hover:bg-blue-700">
                      {addDeviceLoading ? t('processing') : t('add')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddDeviceForm(false)}>{t('cancel')}</Button>
                  </div>
                </form>
              </Card>
            }

            {loading ? // Use loading state here for devices tab
              <div className="text-center p-8 text-gray-500">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p>{t('loadingData')}</p>
              </div> :
              userDevices.length === 0 ? // If not loading and no devices
                <div className="text-center p-10">
                  <p>{t('noDevicesFound')}</p>
                </div> :
                // Otherwise, render existing devices using the function
                renderDevices()
            }
          </div>
        }

        {activeTab === 'reports' && renderReports()}

        {activeTab === 'profile' &&
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">{t('myProfile')}</h3>
              {!editMode &&
                <Button onClick={() => {
                  setEditMode(true);
                  // Initialize form data when entering edit mode
                  setUserInfoData({
                    full_name: user.full_name || '',
                    phone_number: user.phone_number || '',
                    currentPassword: '',
                    newPassword: '',
                    confirmNewPassword: ''
                  });
                }} variant="outline">
                  <User className="w-4 h-4 ml-2" />
                  {t('editProfile')}
                </Button>
              }
            </div>

            {editMode ? (
              <form onSubmit={handleSaveUserInfo} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('fullName')}</label>
                    <Input
                      value={userInfoData.full_name}
                      onChange={(e) => setUserInfoData({ ...userInfoData, full_name: e.target.value })}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('phoneNumber')}</label>
                    <Input
                      type="tel"
                      inputMode="numeric"
                      value={userInfoData.phone_number}
                      onChange={(e) => setUserInfoData({ ...userInfoData, phone_number: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      dir="ltr"
                      className="text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('nationalId')}</label>
                    <Input
                      type="tel"
                      inputMode="numeric"
                      value={user.national_id || ''}
                      disabled={true}
                      dir="ltr"
                      className="text-left bg-gray-100"
                    />
                    <p className="text-xs text-gray-500 mt-1">{t('cannotChangeNationalId')}</p>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <h4 className="font-semibold text-gray-800">{t('changePassword')}</h4>
                  <p className="text-sm text-gray-600">{t('changePasswordNote')}</p>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('currentPassword')}</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={userInfoData.currentPassword}
                        onChange={(e) => setUserInfoData({ ...userInfoData, currentPassword: e.target.value })}
                        dir="ltr"
                        className="text-left pr-10" // Changed to pr-10
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2" // Changed to right-3
                      >
                        {showPassword ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('newPassword')}</label>
                      <Input
                        type="password"
                        value={userInfoData.newPassword}
                        onChange={(e) => setUserInfoData({ ...userInfoData, newPassword: e.target.value })}
                        placeholder={t('passwordRequirements')}
                        dir="ltr"
                        className="text-left"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('confirmPassword')}</label>
                      <Input
                        type="password"
                        value={userInfoData.confirmNewPassword}
                        onChange={(e) => setUserInfoData({ ...userInfoData, confirmNewPassword: e.target.value })}
                        placeholder={t('confirmPasswordPlaceholder')}
                        dir="ltr"
                        className="text-left"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditMode(false)}>
                    {t('cancel')}
                  </Button>
                  <Button type="submit" disabled={saveLoading} className="bg-green-600 hover:bg-green-700">
                    <Save className="w-4 h-4 ml-2" />
                    {saveLoading ? t('saving') : t('saveChanges')}
                  </Button>
                </div>
              </form>
            ) : (
              // Display mode - show current user data
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('fullName')}</label>
                    <div className="p-3 bg-gray-50 rounded-md border">
                      <span className="text-gray-900" dir="rtl">{user.full_name}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('phoneNumber')}</label>
                    <div className="p-3 bg-gray-50 rounded-md border">
                      <span className="text-gray-900" dir="ltr">{user.phone_number}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('nationalId')}</label>
                    <div className="p-3 bg-gray-50 rounded-md border">
                      <span className="text-gray-900" dir="ltr">{user.national_id}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        }
        <NotificationModal
          isOpen={notificationState.isOpen}
          onClose={() => setNotificationState({ ...notificationState, isOpen: false })}
          title={notificationState.title}
          status={notificationState.status}>

          {notificationState.content}
        </NotificationModal>

        {/* Sell Device Modal */}
        <SellDeviceModal
          isOpen={showSellModal}
          onClose={() => setShowSellModal(false)}
          onSubmit={handleSellDevice}
          device={deviceToSell}
          sellFormData={sellFormData}
          setSellFormData={setSellFormData}
          loading={sellLoading}
          t={t} />

      </CardContent>
    </Card>);
}
