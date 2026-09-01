
import React, { useState, useEffect, useContext } from "react";
import { AppContext } from './Layout.jsx';
import { StolenDevice } from '@/api/entities';
import { PurchaseCertificate } from '@/api/entities';
import { User } from '@/api/entities';
import { Search, ShieldAlert, Store, UserCog, CheckCircle, AlertTriangle, ShoppingCart, Key, FileText, Plus, X, Edit, Trash2, Printer, Menu, Copy, Check, PhoneCall, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import NotificationModal from '../components/NotificationModal';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import UserLoginModal from '../components/UserLoginModal';
import UserDashboard from '../components/UserDashboard';
import { checkDevice } from '@/api/functions';
import { findUserByNationalId } from '@/api/functions';
import LocationSelector from '../components/LocationSelector';
import UserProfileTab from '../components/UserProfileTab';
import { createStolenDeviceReport } from '@/api/functions';
import { createPurchaseCertificate } from '@/api/functions';
import { getAdminDashboardData } from '@/api/functions'; // NEW
import { updateStolenDeviceReport } from '@/api/functions'; // NEW
import { getNextCertificateNumber } from '@/api/functions';

// Helper to normalize numbers - AND convert to lowercase for serials
const normalizeSerial = (text) => {
  if (!text) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  let normalized = String(text).toLowerCase(); // Convert to lowercase
  for (let i = 0; i < arabicNumbers.length; i++) {
    normalized = normalized.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
  }
  return normalized;
};


// Helper to normalize numbers
const normalizeNumbers = (text) => {
  if (!text) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩'; // Corrected arabic numbers
  const englishNumbers = '0123456789';
  let normalized = String(text);
  for (let i = 0; i < arabicNumbers.length; i++) {
    normalized = normalized.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
  }
  return normalized;
};

// Helper to normalize phone numbers consistently
const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Convert Arabic numerals to English
  let normalized = normalizeNumbers(phone);
  // Remove any non-digit characters
  normalized = normalized.replace(/\D/g, '');
  // Ensure it starts with 05 and is 10 digits
  if (normalized.length === 9 && !normalized.startsWith('0')) {
    normalized = '0' + normalized;
  }
  return normalized;
};


// Input validation helpers
// Converts Arabic-Indic digits (typed by an Arabic mobile keyboard) to
// Western digits before stripping anything else — otherwise those digits
// get silently deleted (they aren't in [0-9]) instead of converted, which
// can corrupt an ID typed on such a keyboard into something that no
// longer matches the account it belongs to.
const enforceNumeric = (value) => normalizeNumbers(value).replace(/[^0-9]/g, '');
const enforceAlphabetic = (value) => value.replace(/[^a-zA-Z\u0600-\u06FF\s]/g, '');
const isValidLocation = (value) => !/^[0-9\s]+$/.test(value.trim());

// NEW: Auto-detect ID type from number
const detectIdType = (idNumber) => {
  if (!idNumber || String(idNumber).length !== 10) return null;
  const firstDigit = String(idNumber).charAt(0);
  if (firstDigit === '1') return 'national_id';
  if (firstDigit === '2') return 'resident_id';
  if (firstDigit === '3' || firstDigit === '7') return 'commercial_reg';
  return null;
};

// ID validation helper - Updated to auto-detect type
const validateId = (id) => {
  if (!id || String(id).length !== 10) return false;
  const detectedType = detectIdType(id);
  return detectedType !== null;
};

// REMOVED: generateReportId function

// Generate unique certificate number with sequential numbering. Uses a
// dedicated endpoint (rather than listing purchase_certificates) so this
// public, no-login flow never pulls the previous buyer's full record
// (name/national ID/phone) over the wire just to read one field off it.
const generateCertificateNumber = async () => {
  try {
    return await getNextCertificateNumber();
  } catch (error) {
    console.error("Failed to generate certificate number:", error);
    const timestamp = Date.now();
    return timestamp.toString().slice(-10);
  }
};

// Component for copying report ID
const CopyButton = ({ text, t }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  return (
    <Button
      onClick={handleCopy}
      size="sm"
      className={`mt-2 ${copied ? 'bg-green-600 hover:bg-green-700' : 'bg-teal-600 hover:bg-teal-700'}`}
    >
      {copied ? <Check className="w-4 h-4 ml-2" /> : <Copy className="w-4 h-4 ml-2" />}
      {copied ? t('copied') : t('copyReportId')}
    </Button>
  );
};

// The page component receives lang from Layout
export default function HomePage() {
  const { showUserLogin, setShowUserLogin, loggedInUser, setLoggedInUser, userType, setUserType, lang } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState('check');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState({ isOpen: false, title: '', content: null, status: 'default' });
  const [checkResult, setCheckResult] = useState(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [preFilledSerial, setPreFilledSerial] = useState('');


  const t = (key) => translations[lang][key] || key;

  const tabs = [
    { id: 'check', label: t('checkDevice'), icon: '🔍' },
    { id: 'report', label: t('reportTheft'), icon: '🚨' },
    { id: 'store', label: t('buyDevice'), icon: '🛒' }];


  const adminTab = { id: 'admin', label: t('manageReports'), icon: '⚙️' };
  const userTab = { id: 'user', label: t('myAccount'), icon: '👤' };

  const [refreshKey, setRefreshKey] = useState(0);
  const handleDataUpdate = () => {
    setRefreshKey(prevKey => prevKey + 1);
  };

  const handleCheckDevice = async (e) => {
    e.preventDefault();
    const serialNumberInput = e.target.serialNumber.value;
    const serialNumber = normalizeSerial(serialNumberInput); // Use the new function
    if (!serialNumber) return;

    setLoading(true);
    setCheckResult(null);

    try {
      // Guard against the functions module or SDK not being available at runtime.
      if (typeof checkDevice !== 'function') {
        setNotification({ isOpen: true, title: t('errorTitle'), content: <p>{t('certificateErrorMessage')}</p>, status: 'danger' });
      } else {
        const { data: result } = await checkDevice({ serialNumber: serialNumber });
        setCheckResult({ ...result, originalSerial: serialNumberInput });
      }
    } catch (error) {
      console.error("Check device error:", error);
      setNotification({ isOpen: true, title: t('errorTitle'), content: <p>{error.message || t('certificateErrorMessage')}</p>, status: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  // NEW: Function to clear check results
  const handleClearCheckResult = () => {
    setCheckResult(null);
  };

  // Handle user login success
  const handleUserLoginSuccess = (type, userData) => {
    setUserType(type);
    setLoggedInUser(userData);
    // Persist session so Layout and other pages can read it
    try {
      localStorage.setItem('loggedInUser', JSON.stringify(userData));
      localStorage.setItem('userType', type);
      window.dispatchEvent(new CustomEvent('app:login', { detail: { user: userData, userType: type } }));
    } catch (e) {
      console.warn('Failed to persist login', e);
    }
    if (type === 'admin') {
      setActiveTab('admin');
    } else {
      setActiveTab('user');
    }
    setShowUserLogin(false);
  };

  // Handle user logout
  const handleUserLogout = () => {
    setLoggedInUser(null);
    setUserType(null);
    setActiveTab('check');
    // Clear every place the session is persisted — this only reset
    // Layout's in-memory state before, so localStorage still had the old
    // user/session token in it and a page refresh silently logged the
    // same account back in.
    try {
      localStorage.removeItem('loggedInUser');
      localStorage.removeItem('userType');
    } catch {
      // localStorage unavailable — nothing more we can do here
    }
    User.clear();
  };

  // NEW: Handle quick purchase navigation
  const handleQuickPurchase = (serialNumber) => {
    setPreFilledSerial(serialNumber);
    setActiveTab('store');
  };

  const renderContent = () => {
    if (loading && activeTab !== 'check') return <div className="text-center p-10 text-white">{t('loadingData')}</div>;

    switch (activeTab) {
      case 'check':
        return <CheckDeviceTab t={t} handleCheckDevice={handleCheckDevice} checkResult={checkResult} onQuickPurchase={handleQuickPurchase} loading={loading} onClearResult={handleClearCheckResult} userType={userType} />;
      case 'report':
        return <ReportTheftTab t={t} setNotification={setNotification} onReportAdded={handleDataUpdate} lang={lang} />;
      case 'store':
        return <StorePurchaseTab t={t} setNotification={setNotification} onCertificateIssued={handleDataUpdate} preFilledSerial={preFilledSerial} setPreFilledSerial={setPreFilledSerial} userType={userType} />;
      case 'admin':
        return <AdminDashboardTab t={t} onDataUpdate={handleDataUpdate} refreshKey={refreshKey} onLogout={handleUserLogout} userType={userType} />;
      case 'user':
        if (!loggedInUser) {
          return <div className="text-center p-10 text-white">{t('loadingData')}</div>;
        }
        // UserDashboard itself might handle showing UserProfileTab based on its internal state
        return <UserDashboard t={t} user={loggedInUser} onLogout={handleUserLogout} setNotification={setNotification} userType={userType} />;
      default:
        return <p className="text-white">{t('underDevelopment')}</p>;
    }
  };

  // Show appropriate tabs based on user type
  let allTabs = [...tabs];
  if (userType === 'admin') {
    allTabs.push(adminTab);
  } else if (userType === 'regular') {
    allTabs.push(userTab);
  }

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
      <div className="bg-white/90 backdrop-blur-xl border border-white/30 rounded-2xl shadow-2xl mb-6 sm:mb-8 transition-all duration-300 hover:shadow-lg hover:scale-[1.01] overflow-hidden">
        <div className="sm:hidden">
          <div
            className="flex items-center justify-between p-4 border-b border-gray-200 cursor-pointer"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
          >
            <h3 className="text-lg font-bold text-gray-800">
              {allTabs.find((tab) => tab.id === activeTab)?.label}
            </h3>
            <div className="flex items-center">
              <Menu className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="hidden sm:flex">
          {allTabs.map((tab) =>
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-5 px-6 text-center font-bold transition-all duration-300 relative overflow-hidden ${activeTab === tab.id ?
                'text-white bg-gradient-to-r from-teal-600 to-teal-700' :
                'text-gray-600 bg-white hover:bg-gradient-to-r hover:from-teal-50 hover:to-teal-100 hover:text-teal-600'}`
              }>

              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </div>
              {activeTab === tab.id && <div className="absolute inset-0 bg-gradient-to-r from-teal-500 to-teal-600 opacity-0 hover:opacity-100 transition-opacity duration-300"></div>}
            </button>
          )}
        </div>

        <div className="sm:hidden">
          <AnimatePresence>
            {showMobileMenu &&
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-white">

                <div className="grid grid-cols-1 gap-2 p-4">
                  {allTabs.map((tab) =>
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setShowMobileMenu(false); // Close menu on tab click
                      }}
                      className={`w-full p-4 rounded-lg transition-all duration-300 font-bold text-right ${activeTab === tab.id ?
                        'text-white bg-gradient-to-r from-teal-600 to-teal-700' :
                        'text-gray-600 bg-gray-50 hover:bg-teal-50 hover:text-teal-600'}`
                      }>

                      <div className={`flex items-center justify-start space-x-3 space-x-reverse`}>
                        <span className="text-xl">{tab.icon}</span>
                        <span>{tab.label}</span>
                      </div>
                    </button>
                  )}
                </div>
              </motion.div>
            }
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}>

          {renderContent()}
        </motion.div>
      </AnimatePresence>

      {/* User Login Modal - Updated */}
      <UserLoginModal
        isOpen={showUserLogin}
        onClose={() => setShowUserLogin(false)}
        onLoginSuccess={handleUserLoginSuccess}
        t={t}
      />

      <NotificationModal
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        title={notification.title}
        status={notification.status}>

        {notification.content}
      </NotificationModal>
    </div>);

}

// NEW: Helper function to mask ID numbers
const maskIdNumber = (id) => {
  if (!id || typeof id !== 'string' || id.length < 5) {
    return id; // Return as is if it's not a long enough string
  }
  // Example: 1234567890 -> 12******90
  return `${id.slice(0, 2)}******${id.slice(-2)}`;
};


// Function to print certificate using HTML - Updated with all changes
const printCertificateHtml = (certificate, t, userType) => {
  const isAdmin = userType === 'admin';

  // Helper to safely display data, replacing null/undefined with '-'
  const display = (value) => value || '-';

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

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="${translations[t('lang')].dir}" lang="${translations[t('lang')].lang}">
        <head>
            <meta charset="UTF-8">
            <title>${t('certificateOfPurchase')} - ${t('certificateNumber')} ${display(certificate.certificateNumber)}</title>
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
                        ${t('certificateNumber')}: ${display(certificate.certificateNumber)}
                    </div>
                    <div class="confirmation-box">
                        ✅ ${t('certificateDisclaimer')}
                    </div>
                    
                    <div class="section-title">${t('deviceInfo')}</div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">${t('serialNumberLabel')}</div>
                            <div class="info-value">${display(certificate.serialNumber)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">${t('deviceType')}</div>
                            <div class="info-value">${deviceTranslations[certificate.deviceType] || display(certificate.deviceType)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">${t('purchasePrice')}</div>
                            <div class="info-value">${display(certificate.purchasePrice)} ${t('currency')}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">${t('issueDate')}</div>
                            <div class="info-value">${new Date(certificate.issueDate).toLocaleDateString(translations[t('lang')].locale)}</div>
                        </div>
                    </div>

                    <div class="section-title">${t('buyerInfo')}</div>
                    <div class="info-grid">
                        <div class="info-item" style="grid-column: span 2;">
                            <div class="info-label">${t('buyerName')}</div>
                            <div class="info-value">${display(certificate.buyerName)}${certificate.buyerNameAtSale ? ` / ${certificate.buyerNameAtSale}` : ''}</div>
                        </div>
                         <div class="info-item">
                            <div class="info-label">${t('idType')}</div>
                            <div class="info-value">${idTypeTranslations[certificate.buyerIdType] || display(certificate.buyerIdType)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">${t('idNumber')}</div>
                            <div class="info-value">${isAdmin ? display(certificate.buyerId) : maskIdNumber(certificate.buyerId)}</div>
                        </div>
                    </div>

                    <div class="section-title">${t('sellerInfo')}</div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">${t('idType')}</div>
                            <div class="info-value">${idTypeTranslations[certificate.sellerIdType] || display(certificate.sellerIdType)}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">${t('idNumber')}</div>
                            <div class="info-value">${isAdmin ? display(certificate.sellerNationalId) : maskIdNumber(certificate.sellerNationalId)}</div>
                        </div>
                        <div class="info-item" style="grid-column: span 2;">
                            <div class="info-label">${t('phoneNumber')}</div>
                            <div class="info-value">${display(certificate.sellerPhone)}</div>
                        </div>
                    </div>
                </main>

                <footer>
                    <div>${t('publicSecurity')} - ${t('rightsReserved')} ${new Date().getFullYear()}</div>
                    <div>${t('certificateIssueConfirmation')} ${new Date().toLocaleDateString(translations[t('lang')].locale)} ${new Date().toLocaleTimeString(translations[t('lang')].locale, { hour: '2-digit', minute: '2-digit' })} ${t('atTime')}</div>
                </footer>
            </div>
        </body>
        </html>
    `);

  printWindow.document.close();

  printWindow.addEventListener('load', () => {
    setTimeout(() => {
      printWindow.print();
      printWindow.addEventListener('afterprint', () => {
        printWindow.close();
      });
    }, 500);
  });
};


// Check Device Tab Component - Updated with proper date formatting
const CheckDeviceTab = ({ t, handleCheckDevice, checkResult, onQuickPurchase, loading, onClearResult, userType }) => {
  // Use the shared printCertificateHtml function
  const printCertificate = (certificate) => printCertificateHtml(certificate, t, userType);

  // Helper function to format date safely
  const formatDate = (dateString) => {
    if (!dateString) return 'غير محدد';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'غير محدد';
      return date.toLocaleDateString(translations[t('lang')].locale);
    } catch (error) {
      return 'غير محدد';
    }
  };

  // If the device is stolen, show a full-width, centered alert tab
  if (checkResult?.status === 'stolen') {
    return (
      <motion.div
        key="stolen-overlay"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="flex justify-center items-center py-4 sm:py-8 px-4"
      >
        <div className="w-full max-w-md sm:max-w-2xl bg-gradient-to-br from-red-600 to-red-800 text-white rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 text-center pulse-animation border-2 sm:border-4 border-red-400 relative">
          {/* X Close Button */}
          <button
            onClick={onClearResult}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 text-white hover:text-gray-200 transition-colors duration-200"
          >
            <X className="w-6 h-6 sm:w-8 sm:h-8" />
          </button>

          <AlertTriangle className="w-12 sm:w-20 h-12 sm:w-20 mx-auto mb-3 sm:mb-6 text-yellow-300 drop-shadow-lg" />
          <h2 className="text-xl sm:text-4xl font-extrabold mb-2 sm:mb-4 drop-shadow-md leading-tight">{t('stolenDeviceTitle')}</h2>
          <p className="text-red-200 text-sm sm:text-lg mb-3 sm:mb-6">{t('warningDeviceStolen')}</p>

          <div className="bg-black bg-opacity-20 rounded-xl p-3 sm:p-4 mb-4 sm:mb-8 text-xs sm:text-lg space-y-1 sm:space-y-2">
            <p><strong>{t('deviceType')}:</strong> {t(`device${checkResult.device.deviceType.charAt(0).toUpperCase() + checkResult.device.deviceType.slice(1)}`)}</p>
            <p><strong>{t('reportRegistrationDate')}:</strong> {formatDate(checkResult.device.created_date)}</p>
            <p><strong>{t('theftDate')}:</strong> {formatDate(checkResult.device.theftDate)}</p>
            <p><strong>{t('theftLocation')}:</strong> {checkResult.device.location}</p>
          </div>

          <h3 className="text-lg sm:text-2xl font-bold text-yellow-300 mb-2 sm:mb-3">{t('emergencyCall')}</h3>
          <p className="text-red-100 mb-4 sm:mb-5 text-xs sm:text-base">{t('reportTo911')}</p>

          <a href="tel:911" className="block w-full bg-white text-red-700 hover:bg-red-100 border-2 sm:border-4 border-white rounded-xl sm:rounded-2xl shadow-2xl transform hover:scale-105 transition-all duration-300 py-3 sm:py-5 px-4 sm:px-6 font-black text-lg sm:text-3xl">
            <div className="flex items-center justify-center space-x-2 space-x-reverse">
              <PhoneCall className="w-5 sm:w-8 h-5 sm:h-8 animate-bounce" />
              <span>{t('call911')}</span>
            </div>
          </a>
        </div>
      </motion.div>
    );
  }

  // Default view for checking device
  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] p-4 sm:p-8">
          <CardHeader className="p-0 mb-6">
            <CardTitle className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-teal-800 to-teal-600 bg-clip-text text-transparent mb-6 sm:mb-8 flex items-center">
              <div className="bg-gradient-to-r from-teal-500 to-teal-700 p-2 sm:p-3 rounded-xl ml-3 shadow-lg">
                <Search className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
              {t('checkSerialTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <form onSubmit={handleCheckDevice} className="space-y-4 sm:space-y-6">
              <div>
                <label htmlFor="serialNumber" className="block text-sm font-bold text-gray-700 mb-3">{t('serialNumberLabel')}</label>
                <Input
                  id="serialNumber"
                  name="serialNumber"
                  placeholder={t('serialNumberPlaceholder')}
                  required
                  dir="ltr" className="bg-slate-200 text-left p-3 text-base flex ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm w-full sm:p-4 border-2 border-teal-200 rounded-xl focus:ring-4 focus:ring-teal-300 focus:border-teal-500 transition-all duration-300 backdrop-blur-sm hover:border-teal-300 h-12 sm:h-14 sm:text-lg" />
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-teal-600 to-teal-800 text-white py-3 sm:py-4 px-6 rounded-xl font-bold text-base sm:text-lg hover:from-teal-700 hover:to-teal-900 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl h-12 sm:h-16">
                {loading ? t('checking') : `🔍 ${t('checkNowButton')}`}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] p-4 sm:p-8">
          <CardHeader className="p-0 mb-6">
            <CardTitle className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-green-500 to-teal-500 bg-clip-text text-transparent mb-6 sm:mb-8 flex items-center">
              <div className="bg-gradient-to-r from-green-500 to-teal-500 p-2 sm:p-3 rounded-xl ml-3 shadow-lg">
                <CheckCircle className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
              {t('checkResultTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-8 sm:py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
                  <p className="text-gray-500 text-base sm:text-lg font-medium mt-4">{t('checkingDevice')}</p>
                </motion.div>
              ) : !checkResult ?
                <motion.div key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-8 sm:py-12">
                  <div className="floating-animation">
                    <Search className="w-16 sm:w-20 h-16 sm:h-20 mx-auto text-gray-300 mb-4 sm:mb-6" />
                  </div>
                  <p className="text-gray-500 text-base sm:text-lg font-medium">{t('enterSerialToStart')}</p>
                  <p className="text-gray-400 text-sm mt-2">{t('resultWillShow')}</p>
                </motion.div> :
                checkResult.status === 'safe' ?
                  <motion.div key="safe" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center success-glow rounded-2xl p-2">
                    <div className="bg-gradient-to-r from-green-500 to-teal-500 p-4 sm:p-6 rounded-full w-16 sm:w-24 h-16 sm:h-24 mx-auto mb-4 sm:mb-6">
                      <CheckCircle className="w-8 sm:w-12 h-8 sm:h-12 text-white mx-auto" />
                    </div>
                    <h3 className="2xl sm:text-3xl font-bold text-green-600 mb-4">{t('safeDeviceTitle')}</h3>
                    <div className="bg-gradient-to-r from-green-50 to-teal-50 border-2 border-green-300 rounded-2xl p-4 sm:p-6">
                      <p className="text-green-800 font-bold mb-4 text-base sm:text-lg">{t('deviceSafeForTransaction')}</p>
                      <p className="text-green-700 font-semibold text-sm sm:text-base"><strong>{t('serialNumberLabel')}:</strong> {checkResult.originalSerial}</p>
                      {checkResult.certificate &&
                        <div className="mt-4">
                          <h4 className="text-teal-800 font-bold text-base sm:text-lg mb-2">{t('existingCertificate')}</h4>
                          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 sm:p-4">
                            <p className="font-semibold text-teal-800 mb-2">{t('certificateNumber')}: {checkResult.certificate.certificateNumber}</p>
                          </div>
                        </div>
                      }
                      {/* Quick Purchase Button */}
                      <div className="mt-4">
                        <Button
                          onClick={() => onQuickPurchase(checkResult.originalSerial)}
                          className="w-full bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white py-3 px-6 rounded-xl font-bold text-base transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                        >
                          🛒 {t('buyThisDevice')}
                        </Button>
                      </div>
                    </div>
                  </motion.div> :
                  checkResult.status === 'unknown' ?
                    <motion.div key="unknown" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center rounded-2xl p-2">
                      <div className="bg-gradient-to-r from-slate-400 to-slate-500 p-4 sm:p-6 rounded-full w-16 sm:w-24 h-16 sm:h-24 mx-auto mb-4 sm:mb-6">
                        <AlertTriangle className="w-8 sm:w-12 h-8 sm:h-12 text-white mx-auto" />
                      </div>
                      <h3 className="2xl sm:text-3xl font-bold text-slate-600 mb-4">{t('unknownDeviceTitle')}</h3>
                      <div className="bg-slate-50 border-2 border-slate-300 rounded-2xl p-4 sm:p-6">
                        <p className="text-slate-700 font-medium mb-4 text-sm sm:text-base">{t('deviceNotRegisteredMessage')}</p>
                        <p className="text-slate-600 font-semibold text-sm sm:text-base"><strong>{t('serialNumberLabel')}:</strong> {checkResult.originalSerial}</p>
                        <div className="mt-4">
                          <Button
                            onClick={() => onQuickPurchase(checkResult.originalSerial)}
                            className="w-full bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white py-3 px-6 rounded-xl font-bold text-base transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                          >
                            🛒 {t('buyThisDevice')}
                          </Button>
                        </div>
                      </div>
                    </motion.div> : null
              }
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>

      {/* Legal Warning - Mobile Responsive */}
      <div className="mt-6 sm:mt-8 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-2xl p-4 sm:p-8 shadow-2xl transition-all duration-300 hover:scale-[1.02] danger-glow">
        <div className="flex flex-col sm:flex-row items-start">
          <div className="bg-gradient-to-r from-red-500 to-orange-500 p-3 sm:p-4 rounded-xl mb-4 sm:mb-0 sm:ml-4 shadow-lg floating-animation">
            <AlertTriangle className="w-6 sm:w-8 h-6 sm:h-8 text-white" />
          </div>
          <div>
            <h4 className="text-xl sm:text-2xl font-bold text-red-800 mb-3 sm:mb-4 flex items-center">
              ⚠️ {t('legalWarningTitle')}
            </h4>
            <p className="text-red-700 text-sm sm:text-base leading-relaxed font-medium">
              {t('legalWarningText')}
            </p>
          </div>
        </div>
      </div>
    </div>);
};

// Report Theft Tab Component - Updated to use backend-generated unique report ID
const ReportTheftTab = ({ t, setNotification, onReportAdded, lang }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    reporterNationalId: '', reporterPhone: '',
    deviceType: '', serialNumber: '', theftDate: '', location: '', theftDetails: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    let processedValue = value;

    if (name === 'reporterNationalId' || name === 'reporterPhone') {
      processedValue = enforceNumeric(value);
      if (processedValue.length > 10) {
        processedValue = processedValue.slice(0, 10);
      }
    }
    setFormData((prev) => ({ ...prev, [name]: processedValue }));
  };

  const handleLocationChange = (location) => {
    setFormData((prev) => ({ ...prev, location: location }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // --- VALIDATION START ---
    // Check if all required fields are filled
    const allFieldsFilled = formData.reporterNationalId && formData.reporterPhone && formData.deviceType && formData.serialNumber && formData.theftDate && formData.location;
    if (!allFieldsFilled) {
      setNotification({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('allFieldsRequired')}</p>
      });
      return;
    }

    if (!validateId(formData.reporterNationalId)) {
      setNotification({
        isOpen: true,
        status: 'danger',
        title: t('validationErrorTitle'),
        content: <p>{t('invalidIdFormat')}</p>
      });
      return;
    }

    // Normalize phone number for consistent validation
    const normalizedPhone = normalizePhoneNumber(formData.reporterPhone);
    if (normalizedPhone.length !== 10 || !normalizedPhone.startsWith('05')) {
      setNotification({ isOpen: true, status: 'danger', title: t('validationErrorTitle'), content: <p>{t('invalidPhoneError')}</p> });
      return;
    }

    // Location validation - make sure it's in the proper format (Region - City - District)
    const locationParts = formData.location.split(' - ');
    if (locationParts.length !== 3) {
      setNotification({
        isOpen: true, status: 'danger', title: t('validationErrorTitle'),
        content: <p>{t('invalidLocationSelection')}</p>
      });
      return;
    }
    // --- VALIDATION END ---

    setLoading(true);
    try {
      const serialNumber = normalizeSerial(formData.serialNumber);

      let checkResultData = null;
      if (typeof checkDevice !== 'function') {
        setNotification({ isOpen: true, title: t('errorTitle'), content: <p>{t('certificateErrorMessage')}</p>, status: 'danger' });
        setLoading(false);
        return;
      } else {
        const { data: _checkResultData } = await checkDevice({ serialNumber: serialNumber });
        checkResultData = _checkResultData;
      }

      if (checkResultData?.status === 'stolen') {
        setNotification({ isOpen: true, title: t('reportTheftError'), content: <p>{t('deviceAlreadyReportedStolen')}</p>, status: 'danger' });
        setLoading(false);
        return;
      }

      if (checkResultData?.certificate) {
        const cert = checkResultData.certificate;
        // Check if reporter ID matches the owner ID
        if (cert.buyerId !== formData.reporterNationalId) {
          setNotification({ isOpen: true, title: t('reportTheftError'), content: <p>{t('reporterNotOwnerError')}</p>, status: 'danger' });
          setLoading(false);
          return;
        }

        // Check device type match
        if (cert.deviceType !== formData.deviceType) {
          setNotification({ isOpen: true, title: t('reportTheftError'), content: <p>{t('deviceTypeMismatchError')}</p>, status: 'danger' });
          setLoading(false);
          return;
        }

        // Get the latest user data for phone comparison
        const { data: ownerData } = await findUserByNationalId({ nationalId: cert.buyerId });
        if (!ownerData?.user) {
          setNotification({ isOpen: true, title: t('reportTheftError'), content: <p>{t('reporterNotOwnerError')}</p>, status: 'danger' });
          setLoading(false);
          return;
        }

        // Normalize both phone numbers for comparison
        const userPhoneNormalized = normalizePhoneNumber(ownerData.user.phone_number);
        const inputPhoneNormalized = normalizePhoneNumber(formData.reporterPhone);

        if (userPhoneNormalized !== inputPhoneNormalized) {
          setNotification({ isOpen: true, title: t('reportTheftError'), content: <p>{t('reporterPhoneMismatchError')}</p>, status: 'danger' });
          setLoading(false);
          return;
        }

        await PurchaseCertificate.update(cert.id, { status: 'stolen' });
      }

      const reporterIdType = detectIdType(formData.reporterNationalId);

      const reportData = {
        serialNumber: serialNumber,
        deviceType: formData.deviceType,
        reporterIdType: reporterIdType,
        reporterNationalId: formData.reporterNationalId,
        reporterPhone: normalizedPhone, // Use normalized phone number
        theftDate: formData.theftDate,
        location: formData.location.trim(),
        theftDetails: formData.theftDetails.trim() || '',
        status: 'active'
      };

      // Use the backend function to create the report
      const { data: newReport } = await createStolenDeviceReport(reportData);

      onReportAdded();
      setNotification({
        isOpen: true, status: 'success', title: t('reportSuccessTitle'),
        content: <div>
          <p>{t('reportSuccessMessage')}</p>
          <p className="font-bold text-teal-600 mt-2 text-lg">{t('reportId')}: {newReport.reportId}</p>
          <CopyButton text={newReport.reportId} t={t} />
        </div>
      });

      // Reset form
      setFormData({
        reporterNationalId: '', reporterPhone: '',
        deviceType: '', serialNumber: '', theftDate: '', location: '', theftDetails: ''
      });
    } catch (error) {
      const errorMessage = error.response?.data?.message || t('reportErrorMessage');
      console.error("Report theft error:", error);
      setNotification({
        isOpen: true, status: 'danger', title: t('reportErrorTitle'),
        content: <p>{errorMessage}</p>
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl p-6 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-800 mb-6 flex items-center">
          <ShieldAlert className="w-6 h-6 ml-2 text-red-600" />
          {t('reportTheftTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              name="reporterNationalId"
              type="tel"
              inputMode="numeric"
              value={formData.reporterNationalId}
              onChange={handleChange}
              placeholder={t('reporterNationalId')}
              dir={translations[t('lang')].dir}
              className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />

            <Input
              name="reporterPhone"
              type="tel"
              inputMode="numeric"
              value={formData.reporterPhone}
              onChange={handleChange}
              placeholder={t('reporterPhone')}
              dir="ltr"
              className="bg-slate-200 text-left px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />
          </div>
          <Select name="deviceType" onValueChange={(v) => handleSelectChange('deviceType', v)} required>
            <SelectTrigger className="bg-slate-200 px-3 py-2 text-sm flex h-10 w-full items-center justify-between rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"><SelectValue placeholder={t('selectDeviceType')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="phone">{t('devicePhone')}</SelectItem>
              <SelectItem value="laptop">{t('deviceLaptop')}</SelectItem>
              <SelectItem value="tablet">{t('deviceTablet')}</SelectItem>
              <SelectItem value="watch">{t('deviceWatch')}</SelectItem>
              <SelectItem value="camera">{t('deviceCamera')}</SelectItem>
              <SelectItem value="other">{t('deviceOther')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            name="serialNumber"
            // Removed type="tel" and inputMode="numeric" to allow alphanumeric input
            value={formData.serialNumber}
            onChange={handleChange}
            placeholder={t('serialNumberLabel')}
            dir="ltr"
            className="bg-slate-200 text-left px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            required
          />

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('theftDate')} <span className="text-red-500">*</span></label>
              <Input name="theftDate" type="date" value={formData.theftDate} onChange={handleChange} required className="bg-slate-200 px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />
            </div>
            <div>
              {/* Empty div for spacing, location selector goes below */}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">{t('theftLocation')} <span className="text-red-500">*</span></label>
            <LocationSelector
              value={formData.location}
              onChange={handleLocationChange}
              required={true}
              lang={lang}
            />
          </div>

          <Textarea
            name="theftDetails"
            value={formData.theftDetails}
            onChange={handleChange}
            placeholder={t('theftDetails')}
            dir={translations[t('lang')].dir}
            className="bg-slate-200 text-right px-3 py-2 text-sm flex min-h-[80px] w-full rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <Button type="submit" disabled={loading} className="w-full bg-red-600 text-white hover:bg-red-700 h-12">
            {loading ? t('sending') : t('submitReportButton')}
          </Button>
        </form>
      </CardContent>
    </Card>);

};

// Store Purchase Tab Component - Updated with seller phone verification
const StorePurchaseTab = ({ t, setNotification, onCertificateIssued, preFilledSerial, setPreFilledSerial, userType }) => {
  const [formData, setFormData] = useState({
    serialNumber: '',
    deviceType: '',
    buyerId: '',
    buyerName: '',
    sellerId: '',
    sellerPhone: '',
    purchasePrice: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preFilledSerial) {
      setFormData(prev => ({ ...prev, serialNumber: preFilledSerial }));
      setPreFilledSerial('');
    }
  }, [preFilledSerial, setPreFilledSerial]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let processedValue = value;

    if (name === 'buyerId' || name === 'sellerId') {
      processedValue = enforceNumeric(value);
      if (processedValue.length > 10) {
        processedValue = processedValue.slice(0, 10);
      }
    } else if (name === 'sellerPhone') {
      processedValue = enforceNumeric(value);
      if (processedValue.length > 10) {
        processedValue = processedValue.slice(0, 10);
      }
    } else if (name === 'purchasePrice') {
      processedValue = value.replace(/[^0-9.]/g, '');
    } else if (name === 'buyerName') {
      processedValue = enforceAlphabetic(value);
    }
    setFormData((prev) => ({ ...prev, [name]: processedValue }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const printCertificate = (certificate) => {
    try {
      printCertificateHtml(certificate, t, userType);
    } catch (error) {
      console.error('Failed to print certificate:', error);
      setNotification({
        isOpen: true,
        status: 'danger',
        title: t('printErrorTitle'),
        content: <p>{error.message || t('printErrorMessage')}</p>
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.serialNumber || !formData.deviceType || !formData.buyerId ||
      !formData.buyerName || !formData.sellerId || !formData.sellerPhone || !formData.purchasePrice) {
      setNotification({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('allFieldsRequired')}</p>, status: 'danger' });
      return;
    }

    // Validate ID lengths
    if (formData.buyerId.length !== 10 || formData.sellerId.length !== 10) {
      setNotification({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('invalidIdLength')}</p>, status: 'danger' });
      return;
    }

    // Validate phone number
    if (!formData.sellerPhone.match(/^05\d{8}$/)) {
      setNotification({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('invalidPhoneError')}</p>, status: 'danger' });
      return;
    }

    // Check for same buyer/seller
    if (formData.buyerId === formData.sellerId) {
      setNotification({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('sameBuyerSellerError')}</p>, status: 'danger' });
      return;
    }

    // Validate price
    const price = parseFloat(formData.purchasePrice);
    if (isNaN(price) || price <= 0) {
      setNotification({ isOpen: true, title: t('validationErrorTitle'), content: <p>{t('invalidPriceError')}</p>, status: 'danger' });
      return;
    }

    setLoading(true);

    try {
      // Data is sent as plaintext.
      const normalizedSerialNumber = normalizeSerial(formData.serialNumber);

      // A seller registered with a commercial registration number (a
      // store, not a private individual) can sell to a walk-in buyer who
      // has no account on the system yet. The buyer's national ID is
      // still recorded on the certificate exactly as usual, so if that
      // person later creates an account, their devices already show up
      // (UserDashboard looks up certificates by buyerId == national_id,
      // not by any account link) -- an account isn't a prerequisite for
      // that, just for logging in to view it sooner.
      const sellerIdTypeEarly = detectIdType(formData.sellerId);
      const sellerIsCommercial = sellerIdTypeEarly === 'commercial_reg';

      // Backend `findUserByNationalId` now works reliably with plaintext.
      const { data: buyerCheckResponse } = await findUserByNationalId({ nationalId: formData.buyerId });
      const buyerExists = buyerCheckResponse?.exists && buyerCheckResponse?.data?.user;

      if (!buyerExists && !sellerIsCommercial) {
        setNotification({
          isOpen: true,
          title: t('certificateErrorTitle'),
          content: <p>{t('buyerNotFound')}</p>,
          status: 'danger'
        });
        setLoading(false);
        return;
      }
      const buyerUser = buyerExists ? buyerCheckResponse.data.user : null;

      // A commercial-registration seller (a store) doesn't need an
      // account either -- the phone number typed on the form is taken
      // as-is (there's no registered account to check it against).
      let sellerUser = null;
      if (!sellerIsCommercial) {
        const { data: sellerCheckResponse } = await findUserByNationalId({ nationalId: formData.sellerId });

        if (!sellerCheckResponse?.exists || !sellerCheckResponse?.data?.user) {
          setNotification({
            isOpen: true,
            title: t('certificateErrorTitle'),
            content: <p>{t('sellerNotFound')}</p>,
            status: 'danger'
          });
          setLoading(false);
          return;
        }
        sellerUser = sellerCheckResponse.data.user;

        // NEW: Verify seller's phone number matches what's registered
        if (sellerUser.phone_number !== formData.sellerPhone) {
          setNotification({
            isOpen: true,
            title: t('validationErrorTitle'),
            content: <p>{t('sellerPhoneIncorrect')}</p>,
            status: 'danger'
          });
          setLoading(false);
          return;
        }
      }

      // Backend `checkDevice` will handle plaintext ID comparison
      let checkResultData = null;
      if (typeof checkDevice !== 'function') {
        setNotification({ isOpen: true, title: t('errorTitle'), content: <p>{t('certificateErrorMessage')}</p>, status: 'danger' });
        setLoading(false);
        return;
      } else {
        const { data: _checkResultData } = await checkDevice({ serialNumber: normalizedSerialNumber });
        checkResultData = _checkResultData;
      }

      if (checkResultData.status === 'stolen') {
        setNotification({
          isOpen: true,
          title: t('stolenDeviceTitle'),
          content: <p>{t('deviceReportedStolen')}</p>,
          status: 'danger'
        });
        setLoading(false);
        return;
      }

      // Check ownership and device type if device already has certificate
      if (checkResultData.certificate) {
        const existingCert = checkResultData.certificate;

        // NEW: Validate that the selected device type matches the registered one
        if (existingCert.deviceType !== formData.deviceType) {
          setNotification({
            isOpen: true,
            title: t('ownershipErrorTitle'),
            content: <p>{t('deviceTypeMismatchError')}</p>,
            status: 'danger'
          });
          setLoading(false);
          return;
        }

        // Check if seller is the current owner (checkDevice already returns plaintext buyerId for comparison)
        if (existingCert.buyerId !== formData.sellerId) {
          setNotification({
            isOpen: true,
            title: t('ownershipErrorTitle'),
            content: <p>{t('sellerNotOwner')}</p>,
            status: 'danger'
          });
          setLoading(false);
          return;
        }

        // Mark existing certificate as transferred
        try {
          await PurchaseCertificate.update(existingCert.id, { status: 'transferred' });
        } catch (error) {
          console.error("Failed to update existing certificate:", error);
          // Don't necessarily stop the process, but log the error
        }
      }

      // Generate new certificate
      const newCertificateNumber = await generateCertificateNumber();
      const buyerIdType = detectIdType(formData.buyerId);
      const sellerIdType = detectIdType(formData.sellerId);


      const certificateData = {
        certificateNumber: newCertificateNumber,
        buyerIdType: buyerIdType,
        buyerId: formData.buyerId, // Plaintext
        // Fall back to the typed name when the buyer has no account yet
        // (commercial-registration-seller flow) -- buyerUser is null then.
        buyerName: buyerUser?.full_name || formData.buyerName,
        buyerNameAtSale: formData.buyerName, // Use what user typed in buyerName field
        sellerIdType: sellerIdType,
        sellerNationalId: formData.sellerId, // Plaintext
        sellerPhone: formData.sellerPhone, // Plaintext
        deviceType: formData.deviceType,
        serialNumber: normalizedSerialNumber,
        purchasePrice: price,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'active'
      };

      // Use the new backend function to create the certificate
      const { data: newCertificate } = await createPurchaseCertificate(certificateData);
      onCertificateIssued();

      setNotification({
        isOpen: true,
        title: t('certificateIssuedTitle'),
        content: (
          <div>
            <p>{t('certificateIssuedMessage')}</p>
            <p className="font-bold text-teal-600 mt-2">{t('certificateNumber')}: {newCertificate.certificateNumber}</p>
            <Button onClick={() => printCertificate(newCertificate)} className="mt-4 w-full">
              <Printer className="ml-2 h-4 w-4" /> {t('printCertificate')}
            </Button>
          </div>
        ),
        status: 'success'
      });

      // Reset form
      setFormData({
        serialNumber: '',
        deviceType: '',
        buyerId: '',
        buyerName: '',
        sellerId: '',
        sellerPhone: '',
        purchasePrice: ''
      });

    } catch (error) {
      console.error("Certificate creation error:", error);
      setNotification({
        isOpen: true,
        title: t('certificateErrorTitle'),
        content: <p>{error.response?.data?.message || t('certificateErrorMessage')}</p>,
        status: 'danger'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl p-6 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-800 mb-6 flex items-center">
          <ShoppingCart className="w-6 h-6 ml-2 text-green-600" />
          {t('buyDeviceTitle')}
        </CardTitle>
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
          <p className="text-teal-800 text-sm">
            <strong>{t('forBuyer')}:</strong> {t('forBuyerText')}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              name="buyerId"
              type="tel"
              inputMode="numeric"
              value={formData.buyerId}
              onChange={handleChange}
              placeholder={t('buyerId')}
              dir={translations[t('lang')].dir}
              className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />

            <Input
              name="buyerName"
              value={formData.buyerName}
              onChange={handleChange}
              placeholder={t('buyerName')}
              dir={translations[t('lang')].dir}
              className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Input
              name="sellerId"
              type="tel"
              inputMode="numeric"
              value={formData.sellerId}
              onChange={handleChange}
              placeholder={t('sellerId')}
              dir={translations[t('lang')].dir}
              className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />

            <Input
              name="sellerPhone"
              type="tel"
              inputMode="numeric"
              value={formData.sellerPhone}
              onChange={handleChange}
              placeholder={t('sellerPhone')}
              dir={translations[t('lang')].dir}
              className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              required
            />
          </div>

          <Select name="deviceType" onValueChange={(v) => handleSelectChange('deviceType', v)} required>
            <SelectTrigger className="bg-slate-200 px-3 py-2 text-sm flex h-10 w-full items-center justify-between rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"><SelectValue placeholder={t('selectDeviceType')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="phone">{t('devicePhone')}</SelectItem>
              <SelectItem value="laptop">{t('deviceLaptop')}</SelectItem>
              <SelectItem value="tablet">{t('deviceTablet')}</SelectItem>
              <SelectItem value="watch">{t('deviceWatch')}</SelectItem>
              <SelectItem value="camera">{t('deviceCamera')}</SelectItem>
              <SelectItem value="other">{t('deviceOther')}</SelectItem>
            </SelectContent>
          </Select>

          <Input
            name="serialNumber"
            // Removed type="tel" and inputMode="numeric" to allow alphanumeric input
            value={formData.serialNumber}
            onChange={handleChange}
            placeholder={t('serialNumberLabel')}
            dir="ltr"
            className="bg-slate-200 text-left px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            required
          />

          <Input
            name="purchasePrice"
            type="text"
            inputMode="decimal"
            value={formData.purchasePrice}
            onChange={handleChange}
            placeholder={t('purchasePrice')}
            dir={translations[t('lang')].dir}
            className="bg-slate-200 text-right px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            required
          />

          <Button type="submit" disabled={loading} className="w-full bg-green-600 text-white hover:bg-green-700 h-12">
            {loading ? t('processing') : t('checkAndRegisterButton')}
          </Button>
        </form>
      </CardContent>
    </Card>);

};

// Admin Dashboard Tab
const AdminDashboardTab = ({ t, onDataUpdate, refreshKey, onLogout, userType }) => {
  const [activeAdminTab, setActiveAdminTab] = useState('reports');
  const [searchTerm, setSearchTerm] = useState('');
  const [certSearchTerm, setCertSearchTerm] = useState('');

  const [regionFilter, setRegionFilter] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState('');

  const [adminStolenDevices, setAdminStolenDevices] = useState([]);
  const [adminCertificates, setAdminCertificates] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);

  const [newReportsCount, setNewReportsCount] = useState(0);
  const [lastCheckTime, setLastCheckTime] = useState(localStorage.getItem('lastAdminCheck') || new Date().toISOString());

  const [editingReport, setEditingReport] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyCertificates, setHistoryCertificates] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSerialNumber, setSelectedSerialNumber] = useState('');

  const fetchAdminData = React.useCallback(async () => {
    setAdminLoading(true);
    try {
      // Fetch plaintext data from the backend function
      const { data } = await getAdminDashboardData();
      const devices = data.stolenDevices || [];
      const certs = data.certificates || [];

      setAdminStolenDevices(devices);
      setAdminCertificates(certs);

      const lastCheck = new Date(lastCheckTime);
      const newReports = devices.filter(device =>
        new Date(device.created_date) > lastCheck
      );
      setNewReportsCount(newReports.length);

    } catch (error) {
      console.error("Failed to fetch admin data:", error);
    } finally {
      setAdminLoading(false);
    }
  }, [lastCheckTime]);

  useEffect(() => {
    fetchAdminData();
  }, [refreshKey, fetchAdminData]);

  const markReportsAsSeen = () => {
    const currentTime = new Date().toISOString();
    setLastCheckTime(currentTime);
    localStorage.setItem('lastAdminCheck', currentTime);
    setNewReportsCount(0);
  };

  const handleAdminTabChange = (tabName) => {
    setActiveAdminTab(tabName);
    if (tabName === 'reports' && newReportsCount > 0) {
      markReportsAsSeen();
    }
  };

  const handleApproveClosure = async (report) => {
    try {
      await updateStolenDeviceReport({ reportId: report.id, updates: { status: 'closed' } });
      fetchAdminData();
      setEditingReport(null); // Close the edit view
    } catch (error) {
      console.error("Failed to approve closure:", error);
      alert(t('updateReportErrorMessage'));
    }
  };

  const handleRejectClosure = async (report) => {
    try {
      await updateStolenDeviceReport({
        reportId: report.id,
        updates: {
          status: 'active',
          closureRequestReason: null,
          closureRequestDetails: null
        }
      });
      fetchAdminData();
      setEditingReport(null); // Close the edit view
    } catch (error) {
      console.error("Failed to reject closure:", error);
      alert(t('updateReportErrorMessage'));
    }
  };

  const filteredReports = adminStolenDevices.filter((device) => {
    let textMatch = true;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      textMatch = (
        (device.reportId && String(device.reportId).toLowerCase().includes(searchLower)) ||
        (device.serialNumber && String(device.serialNumber).toLowerCase().includes(searchLower)) ||
        (device.reporterNationalId && String(device.reporterNationalId).toLowerCase().includes(searchLower)) ||
        (device.reporterPhone && String(device.reporterPhone).toLowerCase().includes(searchLower)) ||
        (device.location && String(device.location).toLowerCase().includes(searchLower))
      );
    }

    let regionMatch = true;
    if (regionFilter && regionFilter !== 'null') { // Use 'null' string as value
      regionMatch = device.location && device.location.startsWith(regionFilter);
    }

    let deviceMatch = true;
    if (deviceTypeFilter && deviceTypeFilter !== 'null') { // Use 'null' string as value
      deviceMatch = device.deviceType === deviceTypeFilter;
    }

    return textMatch && regionMatch && deviceMatch;
  });

  const filteredCertificates = certSearchTerm
    ? adminCertificates.filter((cert) => {
      // 1. Normalize Arabic numerals to English and convert to lowercase for general search
      const normalizedSearchInput = normalizeNumbers(certSearchTerm);
      const searchLower = normalizedSearchInput.toLowerCase();

      // 2. Create a "smart search" version for the certificate number
      let smartSearchNumber = null;
      // Check if the normalized search term is purely a number
      if (/^\d+$/.test(normalizedSearchInput)) {
        // Pad the number with leading zeros to match the 10-digit format
        smartSearchNumber = normalizedSearchInput.padStart(10, '0');
      }

      // 3. Return true if any condition is met
      return (
        // Use the smart search number to find a direct match for certificateNumber
        (smartSearchNumber && cert.certificateNumber === smartSearchNumber) ||

        // Keep the original search logic for all other fields
        (cert.certificateNumber && cert.certificateNumber.toLowerCase().includes(searchLower)) ||
        (cert.serialNumber && String(cert.serialNumber).toLowerCase().includes(searchLower)) ||
        (cert.buyerId && String(cert.buyerId).toLowerCase().includes(searchLower)) ||
        (cert.buyerName && String(cert.buyerName).toLowerCase().includes(searchLower)) ||
        (cert.sellerNationalId && String(cert.sellerNationalId).toLowerCase().includes(searchLower))
      );
    })
    : adminCertificates;

  const handleToggleEdit = (report) => {
    if (editingReport && editingReport.id === report.id) {
      setEditingReport(null);
    } else {
      setEditingReport(report);
      setEditFormData({
        serialNumber: report.serialNumber,
        deviceType: report.deviceType,
        reporterPhone: report.reporterPhone,
        theftDate: report.theftDate,
        location: report.location,
        theftDetails: report.theftDetails,
        status: report.status
      });
    }
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    let processedValue = value;

    if (name === 'reporterPhone') {
      processedValue = enforceNumeric(value);
      if (processedValue.length > 10) {
        processedValue = processedValue.slice(0, 10);
      }
    } else if (name === 'location') {
      // Allow Arabic, English, numbers, spaces, and the dash for location formatting
      processedValue = value.replace(/[^a-zA-Z\u0600-\u06FF0-9\s-]/g, '');
    } else if (name === 'serialNumber') {
      // Allow alphanumeric for serial number
      processedValue = value;
    }

    setEditFormData((prev) => ({ ...prev, [name]: processedValue }));
  };

  const handleUpdateReport = async () => {
    if (!editingReport) return;

    if (editFormData.reporterPhone) {
      const phoneNumber = editFormData.reporterPhone;
      if (phoneNumber.length !== 10 || !phoneNumber.startsWith('05')) {
        alert(t('invalidPhoneErrorSpecific'));
        return;
      }
    }

    if (editFormData.location) {
      // Ensure the location is not just numbers or empty after cleaning
      if (!isValidLocation(editFormData.location) || editFormData.location.trim() === '') {
        alert(t('invalidLocationErrorSpecific'));
        return;
      }
    }

    try {
      const updatedData = {
        ...editFormData,
        // The serial number is normalized on the backend if edited (removed client-side normalizeSerial)
      };
      // NEW: Use the backend function to update the report
      await updateStolenDeviceReport({ reportId: editingReport.id, updates: updatedData });
      setEditingReport(null);
      fetchAdminData();
    } catch (error) {
      console.error('Failed to update report:', error);
      alert(t('updateReportErrorMessage'));
    }
  };

  const printCertificate = (certificate) => printCertificateHtml(certificate, t, userType);

  const handleShowHistory = async (serialNumber) => {
    setSelectedSerialNumber(serialNumber);
    setHistoryLoading(true);
    setShowHistoryModal(true);
    try {
      const history = await PurchaseCertificate.filter({ serialNumber: serialNumber }, '-created_date');
      setHistoryCertificates(history);
    } catch (error) {
      console.error("Failed to fetch certificate history:", error);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl p-4 sm:p-6">
      <CardHeader className="p-0 sm:p-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <CardTitle className="text-xl font-bold text-gray-800 flex items-center">
            <UserCog className="w-6 h-6 ml-2 text-teal-600" />
            {t('manageReports')}
          </CardTitle>
          <Button
            onClick={onLogout}
            variant="outline"
            className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 w-full sm:w-auto"
          >
            <LogOut className="w-4 h-4" />
            {t('logout')}
          </Button>
        </div>
        <div className="flex border-b">
          <button
            onClick={() => handleAdminTabChange('reports')}
            className={`flex-1 py-3 px-2 sm:px-4 relative text-sm sm:text-base font-bold ${activeAdminTab === 'reports' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-gray-500'}`}
          >
            {t('theftReports')}
            {newReportsCount > 0 && (
              <span className="absolute top-0 right-0 sm:-top-1 sm:-right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {newReportsCount > 99 ? '99+' : newReportsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleAdminTabChange('certs')}
            className={`flex-1 py-3 px-2 sm:px-4 text-sm sm:text-base font-bold ${activeAdminTab === 'certs' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-gray-500'}`}
          >
            {t('certificates')}
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {activeAdminTab === 'reports' && (
          <div className="space-y-4">
            {newReportsCount > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 mb-4">
                <div className="flex items-center">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 ml-2" />
                  <p className="text-yellow-800 font-semibold text-sm sm:text-base">
                    {newReportsCount === 1
                      ? t('oneNewReport')
                      : `${t('newReportsAlert')} ${newReportsCount} ${t('newReports')}`
                    }
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4 mb-6 bg-gray-50 p-4 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('searchReports')}</label>
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('searchReports')}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('filterByRegion')}</label>
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('allRegions')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="null">{t('allRegions')}</SelectItem>
                      <SelectItem value="الشرقية">{t('easternRegion')}</SelectItem>
                      <SelectItem value="الرياض">{t('riyadhRegion')}</SelectItem>
                      <SelectItem value="مكة المكرمة">{t('makkahRegion')}</SelectItem>
                      <SelectItem value="المدينة المنورة">{t('madinahRegion')}</SelectItem>
                      <SelectItem value="القصيم">{t('qassimRegion')}</SelectItem>
                      <SelectItem value="حائل">{t('hailRegion')}</SelectItem>
                      <SelectItem value="الحدود الشمالية">{t('northernBordersRegion')}</SelectItem>
                      <SelectItem value="الجوف">{t('joufRegion')}</SelectItem>
                      <SelectItem value="تبوك">{t('tabukRegion')}</SelectItem>
                      <SelectItem value="نجران">{t('najranRegion')}</SelectItem>
                      <SelectItem value="جازان">{t('jazanRegion')}</SelectItem>
                      <SelectItem value="عسير">{t('asirRegion')}</SelectItem>
                      <SelectItem value="الباحة">{t('bahahRegion')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('filterByDeviceType')}</label>
                  <Select value={deviceTypeFilter} onValueChange={setDeviceTypeFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('allDeviceTypes')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="null">{t('allDeviceTypes')}</SelectItem>
                      <SelectItem value="phone">{t('devicePhone')}</SelectItem>
                      <SelectItem value="laptop">{t('deviceLaptop')}</SelectItem>
                      <SelectItem value="tablet">{t('deviceTablet')}</SelectItem>
                      <SelectItem value="watch">{t('deviceWatch')}</SelectItem>
                      <SelectItem value="camera">{t('deviceCamera')}</SelectItem>
                      <SelectItem value="other">{t('deviceOther')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(regionFilter && regionFilter !== 'null' || deviceTypeFilter && deviceTypeFilter !== 'null' || searchTerm) && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-sm text-gray-600 px-2 py-1 rounded text-xs">
                    {t('activeFilters')}:
                  </span>
                  {searchTerm && (
                    <span className="bg-teal-100 text-teal-800 px-2 py-1 rounded text-xs">
                      {t('searchText')}: {searchTerm}
                    </span>
                  )}
                  {regionFilter && regionFilter !== 'null' && (
                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                      {t('region')}: {regionFilter}
                    </span>
                  )}
                  {deviceTypeFilter && deviceTypeFilter !== 'null' && (
                    <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">
                      {t('deviceType')}: {t(`device${deviceTypeFilter.charAt(0).toUpperCase() + deviceTypeFilter.slice(1)}`)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm('');
                      setRegionFilter('null');
                      setDeviceTypeFilter('null');
                    }}
                  >
                    <X className="w-4 h-4 ml-1" />{t('clearFilters')}
                  </Button>
                </div>
              )}
            </div>

            {adminLoading ? (
              <div className="text-center p-8 text-gray-500">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto"></div>
                <p>{t('loadingData')}</p>
              </div>
            ) : (
              <div>
                {/* Desktop Table View */}
                <div className="overflow-x-auto hidden md:block">
                  <table className="w-full text-right">
                    <thead className="border-b">
                      <tr>
                        <th className="p-2">{t('reportId')}</th>
                        <th className="p-2">{t('serialNumberLabel')}</th>
                        <th className="p-2">{t('deviceType')}</th>
                        <th className="p-2">{t('reportRegistrationDate')}</th>
                        <th className="p-2">{t('theftDate')}</th>
                        <th className="p-2">{t('location')}</th>
                        <th className="p-2">{t('status')}</th>
                        <th className="p-2">{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReports.map((device) =>
                        <React.Fragment key={device.id}>
                          <tr className={`border-b hover:bg-gray-50 ${device.status === 'pending_closure' ? 'bg-yellow-50' : ''}`}>
                            <td className="p-2 font-bold text-teal-600">{device.reportId}</td>
                            <td className="p-2 font-mono" dir="ltr" style={{ textAlign: 'left' }}>{device.serialNumber}</td>
                            <td className="p-2">{t(`device${device.deviceType.charAt(0).toUpperCase() + device.deviceType.slice(1)}`)}</td>
                            <td className="p-2">{new Date(device.created_date).toLocaleDateString(translations[t('lang')].locale)}</td>
                            <td className="p-2">{new Date(device.theftDate).toLocaleDateString(translations[t('lang')].locale)}</td>
                            <td className="p-2">{device.location}</td>
                            <td className="p-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${device.status === 'active' ? 'bg-red-100 text-red-800' :
                                device.status === 'pending_closure' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-green-100 text-green-800'
                                }`}>
                                {t(`status${device.status.charAt(0).toUpperCase() + device.status.slice(1)}`)}
                              </span>
                            </td>
                            <td className="p-2">
                              <Button size="sm" variant="outline" onClick={() => handleToggleEdit(device)}>
                                <Edit className="w-4 h-4 ml-1" /> {editingReport?.id === device.id ? t('cancel') : t('edit')}
                              </Button>
                            </td>
                          </tr>
                          {editingReport?.id === device.id &&
                            <tr className="bg-gray-50">
                              <td colSpan="8" className="p-0">
                                {/* Edit Form - Remains the same */}
                                <div className="bg-white p-6 m-4 rounded-lg shadow-md border space-y-4">
                                  <h3 className="text-lg font-bold mb-4 text-teal-700">{t('editReport')}: <span className="font-mono">{device.serialNumber}</span></h3>

                                  {device.status === 'pending_closure' && (
                                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                                      <h4 className="font-bold text-yellow-800">{t('userClosureRequest')}</h4>
                                      <p><strong>{t('reasonLabel')}:</strong> {device.closureRequestReason === 'device_found' ? t('deviceFound') : t('otherReason')}</p>
                                      {device.closureRequestDetails && <p><strong>{t('detailsLabel')}:</strong> {device.closureRequestDetails}</p>}
                                      <div className="flex gap-2 mt-4">
                                        <Button onClick={() => handleApproveClosure(device)} className="bg-green-600 hover:bg-green-700">{t('approveClosure')}</Button>
                                        <Button onClick={() => handleRejectClosure(device)} variant="destructive">{t('rejectClosure')}</Button>
                                      </div>
                                    </div>
                                  )}

                                  <div className="grid md:grid-cols-2 gap-4 text-sm mb-4">
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <label className="block text-xs font-medium text-gray-500 mb-1">{t('reporterIdTypeLabel')}</label>
                                      <p className="font-semibold text-gray-800">
                                        {device.reporterIdType === 'national_id' ? t('idNational') :
                                          device.reporterIdType === 'resident_id' ? t('idResident') :
                                            device.reporterIdType === 'commercial_reg' ? t('idCommercial') :
                                              device.reporterIdType}
                                      </p>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <label className="block text-xs font-medium text-gray-500 mb-1">{t('reporterNationalId')}</label>
                                      <p className="font-semibold font-mono text-gray-800" dir="ltr" style={{ textAlign: 'left' }}>{device.reporterNationalId}</p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('serialNumberLabel')}</label>
                                      <Input
                                        name="serialNumber"
                                        value={editFormData.serialNumber || ''}
                                        onChange={handleEditChange}
                                        dir="ltr"
                                        className="text-left" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('reporterPhone')}</label>
                                      <Input
                                        name="reporterPhone"
                                        value={editFormData.reporterPhone || ''}
                                        onChange={handleEditChange}
                                        placeholder="05________"
                                        dir="ltr"
                                        className="text-left" />
                                      <p className="text-xs text-gray-500 mt-1">{t('phoneValidationHint')}</p>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('deviceType')}</label>
                                      <Select value={editFormData.deviceType || ''} onValueChange={(v) => setEditFormData({ ...editFormData, deviceType: v })}>
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
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('theftDate')}</label>
                                      <Input
                                        name="theftDate"
                                        type="date"
                                        value={editFormData.theftDate || ''}
                                        onChange={handleEditChange} />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('location')}</label>
                                      <Input
                                        name="location"
                                        value={editFormData.location || ''}
                                        onChange={handleEditChange}
                                        placeholder={t('theftLocation')}
                                        dir={translations[t('lang')].dir} />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('theftDetails')}</label>
                                      <Textarea
                                        name="theftDetails"
                                        value={editFormData.theftDetails || ''}
                                        onChange={handleEditChange}
                                        placeholder={t('theftDetails')}
                                        dir={translations[t('lang')].dir} />
                                    </div>
                                  </div>

                                  <div className="border-t pt-4 space-y-3">
                                    <div className="flex items-center space-x-2 space-x-reverse">
                                      <Checkbox
                                        id={`status-checkbox-${device.id}`}
                                        checked={editFormData.status === 'closed'}
                                        onCheckedChange={(checked) => setEditFormData({ ...editFormData, status: checked ? 'closed' : 'active' })} />
                                      <label htmlFor={`status-checkbox-${device.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {t('markClosed')}
                                      </label>
                                    </div>

                                    <div className="flex gap-2">
                                      <Button onClick={handleUpdateReport} className="flex-1 bg-teal-600 hover:bg-teal-700">{t('save')}</Button>
                                      <Button variant="outline" onClick={() => setEditingReport(null)} className="flex-1">{t('cancel')}</Button>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          }
                        </React.Fragment>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="space-y-4 md:hidden">
                  {filteredReports.map((device) => (
                    <React.Fragment key={device.id}>
                      <div className={`p-4 border rounded-lg shadow-sm ${device.status === 'pending_closure' ? 'bg-yellow-50 border-yellow-200' : 'bg-white'}`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold text-teal-600">{device.reportId}</p>
                            <p className="font-mono text-sm text-gray-700" dir="ltr">{device.serialNumber}</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${device.status === 'active' ? 'bg-red-100 text-red-800' :
                            device.status === 'pending_closure' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }`}>
                            {t(`status${device.status.charAt(0).toUpperCase() + device.status.slice(1)}`)}
                          </span>
                        </div>
                        <div className="mt-3 text-sm space-y-1 text-gray-600">
                          <p><strong>{t('deviceType')}:</strong> {t(`device${device.deviceType.charAt(0).toUpperCase() + device.deviceType.slice(1)}`)}</p>
                          <p><strong>{t('theftDate')}:</strong> {new Date(device.theftDate).toLocaleDateString(translations[t('lang')].locale)}</p>
                          <p><strong>{t('location')}:</strong> {device.location}</p>
                        </div>
                        <div className="mt-4 border-t pt-3">
                          <Button size="sm" variant="outline" onClick={() => handleToggleEdit(device)} className="w-full">
                            <Edit className="w-4 h-4 ml-1" /> {editingReport?.id === device.id ? t('cancel') : t('edit')}
                          </Button>
                        </div>
                      </div>
                      {editingReport?.id === device.id && (
                        <div className="bg-gray-50 p-4 -mt-2 rounded-b-lg border-x border-b">
                          {/* Mobile Edit Form */}
                          <div className="space-y-4">
                            <h3 className="text-lg font-bold mb-2 text-teal-700">{t('editReport')}</h3>

                            {device.status === 'pending_closure' && (
                              <div className="bg-yellow-100 border-l-4 border-yellow-400 p-3 mb-4 text-sm">
                                <h4 className="font-bold text-yellow-800">{t('userClosureRequest')}</h4>
                                <p><strong>{t('reasonLabel')}:</strong> {device.closureRequestReason === 'device_found' ? t('deviceFound') : t('otherReason')}</p>
                                {device.closureRequestDetails && <p><strong>{t('detailsLabel')}:</strong> {device.closureRequestDetails}</p>}
                                <div className="flex gap-2 mt-3">
                                  <Button size="sm" onClick={() => handleApproveClosure(device)} className="bg-green-600 hover:bg-green-700">{t('approveClosure')}</Button>
                                  <Button size="sm" onClick={() => handleRejectClosure(device)} variant="destructive">{t('rejectClosure')}</Button>
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 text-sm mb-4">
                              <div className="bg-white p-3 rounded-lg border">
                                <label className="block text-xs font-medium text-gray-500 mb-1">{t('reporterIdTypeLabel')}</label>
                                <p className="font-semibold text-gray-800">{device.reporterIdType === 'national_id' ? t('idNational') : device.reporterIdType}</p>
                              </div>
                              <div className="bg-white p-3 rounded-lg border">
                                <label className="block text-xs font-medium text-gray-500 mb-1">{t('reporterNationalId')}</label>
                                <p className="font-semibold font-mono text-gray-800" dir="ltr">{device.reporterNationalId}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('serialNumberLabel')}</label>
                                <Input name="serialNumber" value={editFormData.serialNumber || ''} onChange={handleEditChange} dir="ltr" className="text-left" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('reporterPhone')}</label>
                                <Input name="reporterPhone" value={editFormData.reporterPhone || ''} onChange={handleEditChange} placeholder="05________" dir="ltr" className="text-left" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('deviceType')}</label>
                                <Select value={editFormData.deviceType || ''} onValueChange={(v) => setEditFormData({ ...editFormData, deviceType: v })}>
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
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('theftDate')}</label>
                                <Input name="theftDate" type="date" value={editFormData.theftDate || ''} onChange={handleEditChange} />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('location')}</label>
                                <Input name="location" value={editFormData.location || ''} onChange={handleEditChange} placeholder={t('theftLocation')} dir={translations[t('lang')].dir} />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t('theftDetails')}</label>
                                <Textarea name="theftDetails" value={editFormData.theftDetails || ''} onChange={handleEditChange} placeholder={t('theftDetails')} dir={translations[t('lang')].dir} />
                              </div>
                            </div>

                            <div className="border-t pt-4 space-y-3">
                              <div className="flex items-center space-x-2 space-x-reverse">
                                <Checkbox id={`status-checkbox-mobile-${device.id}`} checked={editFormData.status === 'closed'} onCheckedChange={(checked) => setEditFormData({ ...editFormData, status: checked ? 'closed' : 'active' })} />
                                <label htmlFor={`status-checkbox-mobile-${device.id}`} className="text-sm font-medium">{t('markClosed')}</label>
                              </div>

                              <div className="flex gap-2">
                                <Button onClick={handleUpdateReport} className="flex-1 bg-teal-600 hover:bg-teal-700">{t('save')}</Button>
                                <Button variant="outline" onClick={() => setEditingReport(null)} className="flex-1">{t('cancel')}</Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {filteredReports.length === 0 && !adminLoading && (
                  <div className="text-center p-8 text-gray-500">
                    <p>{t('noReportsFound')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeAdminTab === 'certs' && (
          <div>
            <div className="mb-4">
              <Input
                value={certSearchTerm}
                onChange={(e) => setCertSearchTerm(e.target.value)}
                placeholder={t('searchCertificates')}
                className="w-full" />
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {filteredCertificates.map((cert) =>
                <div key={cert.id} className="border rounded-lg p-3 sm:p-4 bg-gray-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 transition-all hover:shadow-md hover:bg-white">
                  <div className="flex-grow w-full">
                    <div className="flex justify-between items-center gap-2">
                      <p className="font-bold text-teal-700 text-sm sm:text-base">{t('certificateNumber')}: <span className="font-mono text-teal-900">{cert.certificateNumber}</span></p>
                      <p className="text-xs sm:text-sm text-gray-600 mt-1">{t('serialNumberLabel')}: <span className="font-mono">{cert.serialNumber}</span></p>
                      <p className="text-xs sm:text-sm text-gray-600">{t('buyerName')}: {cert.buyerName}</p>
                    </div>
                    <div className="sm:hidden flex items-center justify-end"> {/* Mobile status badge */}
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {t(cert.status)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0">
                    <Button onClick={() => handleShowHistory(cert.serialNumber)} variant="outline" size="sm" className="flex-1 sm:flex-grow-0">
                      {t('viewHistory')}
                    </Button>
                    <Button onClick={() => printCertificate(cert)} className="bg-teal-600 hover:bg-teal-700 flex-1 sm:flex-grow-0" size="sm">
                      <Printer className="w-4 h-4 ml-2" />
                      {t('printCertificate')}
                    </Button>
                    <span className={`hidden sm:inline-flex px-2 py-1 rounded-full text-xs font-semibold ${cert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {t(cert.status)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {showHistoryModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 p-4">
                <div className="bg-white p-6 rounded-lg max-w-2xl w-full mx-4 shadow-xl">
                  <h3 className="text-lg font-bold mb-4 text-teal-800">{t('certificateHistory')} - <span className="font-mono">{selectedSerialNumber}</span></h3>
                  {historyLoading ? (
                    <div className="text-center p-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>
                      <p>{t('loadingData')}</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {historyCertificates.map(hcert => (
                        <div key={hcert.id} className="border p-3 rounded-lg bg-gray-50">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold text-gray-800">{t('certificateNumber')}: {hcert.certificateNumber}</p>
                              <p className="text-sm text-gray-600">{t('buyerName')}: {hcert.buyerName}</p>
                              <p className="text-sm text-gray-600">{t('issueDate')}: {new Date(hcert.issueDate).toLocaleDateString(translations[t('lang')].locale)}</p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${hcert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {t(hcert.status)}
                              </span>
                              <Button onClick={() => printCertificate(hcert)} size="sm" variant="ghost">
                                <Printer className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-6">
                    <Button variant="outline" onClick={() => setShowHistoryModal(false)}>{t('close')}</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>);
};

// UserProfileTab component definition removed from here, as it's now imported from its own file.

const translations = {
  ar: {
    checkDevice: 'فحص جهاز',
    reportTheft: 'الإبلاغ عن سرقة',
    buyDevice: 'شراء جهاز',
    manageReports: 'إدارة البلاغات',
    myAccount: 'حسابي',
    myProfile: 'ملفي الشخصي',
    loadingData: 'جاري تحميل البيانات...',
    checkSerialTitle: 'فحص الرقم التسلسلي',
    serialNumberLabel: 'الرقم التسلسلي (IMEI/Serial)',
    serialNumberPlaceholder: 'أدخل الرقم التسلسلي',
    checkNowButton: 'فحص الجهاز الآن',
    checking: 'جاري الفحص...',
    checkingDevice: 'جاري فحص الجهاز، الرجاء الانتظار...',
    checkResultTitle: 'نتيجة الفحص',
    enterSerialToStart: 'أدخل الرقم التسلسلي لبدء الفحص',
    resultWillShow: 'سيظهر هنا ما إذا كان الجهاز آمناً أم مسروقاً',
    safeDeviceTitle: '✅ جهاز آمن',
    unknownDeviceTitle: 'ℹ️ جهاز غير مسجل',
    deviceNotRegisteredMessage: 'لم يُعثر على أي سجل لهذا الجهاز — لا بلاغ سرقة ولا شهادة شراء مسجلة به. هذا لا يعني بالضرورة أن الجهاز آمن، فقط أنه غير مسجل بالنظام. يُنصح بالتحقق من مصدر الجهاز جيدًا قبل الشراء.',
    existingCertificate: 'تم العثور على شهادة شراء مسجلة لهذا الجهاز:',
    buyerName: 'اسم المشتري',
    issueDate: 'تاريخ الإصدار',
    stolenDeviceTitle: '🚨 جهاز مسروق',
    warningDeviceStolen: 'تحذير: هذا الجهاز مبلغ عنه كمسروق',
    reportRegistrationDate: 'تاريخ تسجيل البلاغ',
    location: 'الموقع',
    reportDate: 'تاريخ البلاغ',
    theftDate: 'تاريخ السرقة',
    theftLocation: 'موقع السرقة',
    reportTo911: 'يجب الإبلاغ فوراً على الرقم 911',
    call911: 'اتصل بالشرطة (911)',
    emergencyCall: 'اتصال طوارئ',
    legalWarningTitle: 'تحذير قانوني مهم',
    legalWarningText: 'وفقاً للأنظمة السعودية، يُعتبر فحص الرقم التسلسلي إلزامياً قبل شراء أي جهاز إلكتروني. عدم الفحص قد يعرضك للمساءلة القانونية في حال ثبت أن الجهاز مسروق.',
    reportTheftTitle: 'الإبلاغ عن سرقة جهاز',
    reporterNationalId: 'رقم الهوية',
    reporterPhone: 'رقم الجوال (05xxxxxxxx)',
    selectDeviceType: 'اختر نوع الجهاز',
    devicePhone: 'هاتف ذكي',
    deviceLaptop: 'لابتوب',
    deviceTablet: 'تابلت',
    deviceWatch: 'ساعة ذكية',
    deviceCamera: 'كاميرا',
    deviceOther: 'أخرى',
    theftDetails: 'تفاصيل إضافية',
    sending: 'جاري الإرسال...',
    submitReportButton: 'تقديم البلاغ',
    reportSuccessTitle: 'تم تقديم البلاغ',
    reportSuccessMessage: 'تم تسجيل بلاغك بنجاح.',
    reportErrorTitle: 'خطأ',
    reportErrorMessage: 'حدث خطأ. قد يكون الرقم التسلسلي مسجلاً.',
    errorTitle: 'خطأ',
    validationErrorTitle: 'خطأ في البيانات',
    invalidPhoneError: 'يجب أن يتكون رقم الجوال من 10 أرقام وأن يبدأ بـ 05.',
    sameBuyerSellerError: 'لا يمكن أن يكون رقم هوية المشتري نفس رقم هوية البائع.',
    invalidLocationError: 'موقع السرقة غير صالح، لا يمكن أن يحتوي على أرقام فقط.',
    invalidLocationSelection: 'يرجى اختيار الموقع بالكامل (المنطقة والمدينة والحي)',
    buyDeviceTitle: 'فحص وتسجيل عملية شراء جهاز',
    forBuyers: 'للمشترين',
    forBuyersText: 'يجب فحص كل جهاز قبل الشراء للتأكد من أنه غير مسروق وتسجيل بيانات العملية.',
    buyerId: 'رقم هوية المشتري',
    sellerId: 'رقم هوية البائع',
    sellerPhone: 'رقم جوال البائع',
    purchasePrice: 'سعر الشراء',
    processing: 'جاري المعالجة...',
    checkAndRegisterButton: 'فحص وتسجيل العملية',
    certificateIssuedTitle: 'تم إصدار الشهادة',
    certificateIssuedMessage: 'تم فحص الجهاز وإصدار شهادة بنجاح.',
    certificateErrorTitle: 'خطأ في إصدار الشهادة',
    certificateErrorMessage: 'حدث خطأ أثناء إصدار الشهادة.',
    adminWelcome: 'مرحباً بك في لوحة تحكم الإدارة.',
    deviceType: 'نوع الجهاز',
    status: 'الحالة',
    statusActive: 'نشط',
    statusClosed: 'مغلق',
    statusPending_closure: 'قيد الإغلاق',
    underDevelopment: 'قيد التطوير...',
    selectIdType: 'اختر نوع هوية المبلغ *',
    reporterIdTypeLabel: 'نوع هوية المبلغ',
    buyerIdType: 'نوع هوية المشتري *',
    sellerIdType: 'نوع هوية البائع *',
    idNational: 'هوية وطنية',
    idResident: 'إقامة',
    idCommercial: 'سجل تجاري',
    printCertificate: 'طباعة الشهادة',
    buyThisDevice: 'شراء هذا الجهاز',
    adminAccessDenied: 'تم رفض الوصول. هذه الصفحة مخصصة للمديرين فقط.',
    adminLoginTitle: 'تسجيل دخول المدير',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    enterUsername: 'أدخل اسم المستخدم',
    enterPassword: 'أدخل كلمة المرور',
    login: 'تسجيل الدخول',
    logging_in: 'جاري تسجيل الدخول...',
    adminLoginErrorTitle: 'خطأ في تسجيل الدخول',
    adminLoginError: 'اسم المستخدم أو كلمة المرور غير صحيحة',
    adminLoginDisclaimer: 'هذا القسم مخصص للمديرين المخولين فقط',
    theftReports: 'بلاغات السرقة',
    certificates: 'الشهادات',
    searchPlaceholder: 'أدخل كلمة البحث...',
    search: 'بحث',
    noResults: 'لا توجد نتائج.',
    noReportsFound: 'لا توجد بلاغات مطابقة للبحث.',
    actions: 'الإجراءات',
    editReport: 'تعديل البلاغ',
    save: 'حفظ',
    markClosed: 'تحديد كمغلق',
    deleteReport: 'حذف البلاغ',
    deleteConfirmation: 'هل أنت متأكد من حذف هذا البلاغ؟ لا يمكن التراجع عن هذا الإجراء.',
    deletePassword: 'كلمة مرور الحذف',
    deleteReason: 'سبب الحذف',
    deleteReasonPlaceholder: 'أدخل سبب حذف البلاغ...',
    confirmDelete: 'تأكيد الحذف',
    deletePasswordError: 'كلمة المرور غير صحيحة.',
    deleteReasonRequired: 'سبب الحذف مطلوب.',
    deleteErrorMessage: 'حدث خطأ أثناء الحذف.',
    deleteSuccess: 'تم الحذف بنجاح.',
    deleteCertificate: 'حذف الشهادة',
    deleteCertificateConfirm: 'هل تريد حذف الشهادة؟',
    idType: 'نوع الهوية',
    idNumber: 'رقم الهوية',
    sellerInfo: 'بيانات البائع',
    phoneNumber: 'رقم الجوال',
    deviceInfo: 'بيانات الجهاز',
    currency: 'ريال',
    certificateDisclaimer: 'إقرار تم فحص الجهاز بتاريخ الإصدار وتبين أنه لا يوجد اشعار على الرقم التسلسلي.',
    edit: 'تعديل',
    delete: 'حذف',
    reportActions: 'إجراءات البلاغ',
    publicSecurity: 'الأمن العام - المملكة العربية السعودية',
    scanToVerify: 'امسح الكود للتحقق من صحة الشهادة',
    rightsReserved: 'جميع الحقوق محفوظة',
    searchCertificates: 'البحث في الشهادات',
    searchReports: 'البحث في البلاغات',
    dir: 'rtl',
    lang: 'ar',
    locale: 'ar-SA',
    qrUrlInfo: 'امسح الكود أو ادخل الرابط:',
    atTime: 'الساعة',
    certificateIssueConfirmation: 'تم إصدار هذه الشهادة بتاريخ',
    phoneValidationHint: 'يجب أن يكون 10 أرقام ويبدأ بـ 05',
    invalidPhoneErrorSpecific: 'رقم الجوال غير صالح. يجب أن يتكون من 10 أرقام ويبدأ بـ 05.',
    invalidLocationErrorSpecific: 'موقع السرقة غير صالح. يجب أن يحتوي على أحرف (لا يمكن أن يكون أرقام فقط).',
    updateReportErrorMessage: 'فشل تحديث البلاغ. يرجى التحقق من البيانات والمحاولة مرة أخرى.',
    reportId: 'رقم البلاغ',
    copyReportId: 'نسخ رقم البلاغ',
    copied: 'تم النسخ',
    id_or_phone_placeholder: 'رقم الهوية أو رقم الجوال',
    allFieldsRequired: 'جميع الحقول مطلوبة',
    oneNewReport: 'يوجد بلاغ جديد واحد',
    newReportsAlert: 'يوجد',
    newReports: 'بلاغات جديدة',
    userLoginTitle: 'تسجيل دخول المستخدم',
    addDevice: 'إضافة جهاز',
    deviceAddedSuccess: 'تم إضافة الجهاز بنجاح',
    deviceAlreadyRegistered: 'هذا الرقم التسلسلي مسجل بالفعل',
    deviceReportedStolen: 'لا يمكن إضافة هذا الجهاز لأنه مبلغ عنه كمسروق',
    addNewDeviceTitle: 'إضافة جهاز جديد تملكه',
    serialNumber: 'الرقم التسلسلي',
    add: 'إضافة',
    register: 'تسجيل حساب جديد',
    nationalId: 'الرقم الهوية الوطنية',
    fullName: 'الاسم الكامل',
    confirmPassword: 'تأكيد كلمة المرور',
    enterFullName: 'أدخل الاسم الكامل',
    passwordRequirements: 'يجب أن لاتقل عن 8 خانات وأن تحتوي على حرف على الأقل وأرقام.',
    confirmPasswordPlaceholder: 'أعد إدخال كلمة المرور',
    forgotPassword: 'نسيت كلمة المرور؟',
    resetPassword: 'إعادة تعيين كلمة المرور',
    resetPasswordInstructions: 'أدخل رقم الهوية ورقم الجوال لإعادة تعيين كلمة المرور',
    back: 'رجوع',
    cancel: 'إلغاء',
    registering: 'جاري التسجيل...',
    resetting: 'جاري الإعادة...',
    loginError: 'اسم المستخدم أو كلمة المرور غير صحيحة',
    registerSuccess: 'تم تسجيل الحساب بنجاح، يمكنك الآن تسجيل الدخول',
    registerError: 'خطأ في تسجيل الحساب',
    resetPasswordSuccess: 'تم إرسال كلمة المرور الجديدة إلى رقم جوالك',
    resetPasswordError: 'خطأ في إعادة تعيين كلمة المرور',
    invalidPasswordError: 'يجب أن تكون كلمة المرور 8 أحرف على الأقل مع رقم وحرف واحد على الأقل',
    passwordMismatchError: 'كلمتا المرور غير متطابقتان',
    sellDeviceTitle: 'بيع الجهاز',
    sellingDeviceInfo: 'معلومات الجهاز المراد بيعه',
    originalDeviceType: 'نوع الجهاز الأصلي',
    confirmDeviceType: 'تأكيد نوع الجهاز',
    sellDevice: 'بيع الجهاز',
    confirmSale: 'تأكيد البيع',
    selectDeviceTypeForSale: 'اختر نوع الجهاز لتأكيد البيع',
    enterBuyerId: 'رقم هوية المشتري',
    enterPurchasePrice: 'سعر البيع',
    cannotSellToYourself: 'لا يمكنك بيع جهاز لنفسك',
    deviceSoldSuccess: 'تم بيع الجهاز بنجاح وإصدار شهادة جديدة للمشتري',
    sellDeviceError: 'خطأ في بيع الجهاز',
    buyerAccountNotFound: 'لا يمكن إتمام البيع. لم يتم العثور على حساب برقم هوية المشتري',
    sellingDevice: 'جاري البيع...',
    salePrice: 'سعر البيع',
    buyerIdLabel: 'رقم هوية المشتري',
    sellThisDevice: 'بيع هذا الجهاز',
    confirmDeviceSale: 'تأكيد بيع الجهاز',
    deviceTypeMustMatch: 'نوع الجهاز المحدد يجب أن يتطابق مع النوع المسجل',
    theftReportSuccess: 'تم الإبلاغ عن السرقة بنجاح',
    reportTheftError: 'خطأ في الإبلاغ عن السرقة',
    logout: 'تسجيل خروج',
    myDevices: 'أجهزتي',
    myReports: 'بلاغاتي',
    devicesYouOwn: 'الأجهزة التي تملكها',
    yourTheftReports: 'بلاغات السرقة الخاصة بك',
    editProfile: 'تعديل الملف الشخصي',
    changePassword: 'تغيير كلمة المرور',
    changePasswordNote: 'اتركها فارغة إذا كنت لا تريد تغيير كلمة المرور',
    currentPassword: 'كلمة المرور الحالية',
    newPassword: 'كلمة المرور الجديدة',
    cannotChangeNationalId: 'لا يمكن تغيير رقم الهوية الوطنية',
    saveChanges: 'حفظ التغييرات',
    saving: 'جاري الحفظ...',
    userInfoUpdated: 'تم تحديث المعلومات بنجاح',
    updateSuccessTitle: 'تم التحديث بنجاح',
    updateError: 'خطأ في تحديث المعلومات',
    updateErrorTitle: 'خطأ في التحديث',
    userNotFound: 'المستخدم غير موجود أو البيانات غير صحيحة.',
    userAlreadyExists: 'رقم الهوية أو رقم الجوال مسجل بالفعل.',
    passwordIncorrectError: 'كلمة المرور الحالية غير صحيحة.',
    invalidPriceError: 'سعر الشراء يجب أن يكون رقماً صحيحاً أكبر من صفر',
    buyerAccountRequired: 'لا يمكن إتمام الشراء. يجب أن يكون لدى المشتري حساب مسجل في النظام برقم الهوية المدخل.',
    invalidBuyerIdLength: 'يجب أن يكون رقم هوية المشتري 10 أرقام بالضبط.',
    invalidIdFormat: 'رقم هوية غير صالح. يجب أن يكون 10 أرقام ويبدأ بـ 1 (هوية وطنية)، 2 (إقامة)، أو 7 (سجل تجاري).',
    invalidIdOrPhoneFormat: 'تنسيق رقم الهوية أو الجوال غير صحيح.',
    verifying: 'جاري التحقق...',
    verifyButton: 'تحقق',
    enterNewPassword: 'الرجاء إدخال كلمة المرور الجديدة.',
    passwordResetSuccess: 'تم إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.',
    backToLogin: 'العودة لتسجيل الدخول',
    active: 'نشط',
    transferred: 'محول',
    viewHistory: 'عرض التاريخ',
    certificateHistory: 'تاريخ شهادات الجهاز',
    requestClosure: 'طلب إغلاق البلاغ',
    requestClosureForReport: 'طلب إغلاق البلاغ',
    closureReason: 'سبب إغلاق البلاغ',
    deviceFound: 'تم العثور على الجهاز',
    otherReason: 'سبب آخر',
    pleaseSpecify: 'يرجى التحديد',
    enterOtherReason: 'يرجى كتابة السبب هنا...',
    submitRequest: 'إرسال الطلب',
    requestSent: 'تم إرسال الطلب',
    closureRequestSubmitted: 'تم إرسال طلب إغلاق البلاغ بنجاح. ستتم مراجعته من قبل المدير.',
    closureRequestError: 'حدث خطأ أثناء إرسال طلب الإغلاق.',
    reasonRequiredWhenOther: 'السبب مطلوب عند اختيار "سبب آخر".',
    userClosureRequest: 'طلب إغلاق من المستخدم',
    reasonLabel: 'السبب',
    detailsLabel: 'التفاصيل',
    approveClosure: 'الموافقة على الإغلاق',
    rejectClosure: 'رفض الإغلاق',
    filterByRegion: 'تصفية حسب المنطقة',
    filterByDeviceType: 'تصفية حسب نوع الجهاز',
    allRegions: 'جميع المناطق',
    allDeviceTypes: 'جميع أنواع الأجهزة',
    easternRegion: 'المنطقة الشرقية',
    riyadhRegion: 'منطقة الرياض',
    makkahRegion: 'منطقة مكة المكرمة',
    madinahRegion: 'المدينة المنورة',
    qassimRegion: 'منطقة القصيم',
    hailRegion: 'منطقة حائل',
    northernBordersRegion: 'الحدود الشمالية',
    joufRegion: 'الجوف',
    tabukRegion: 'تبوك',
    najranRegion: 'نجران',
    jazanRegion: 'جازان',
    asirRegion: 'عسير',
    bahahRegion: 'الباحة',
    activeFilters: 'الفلاتر النشطة',
    searchText: 'نص البحث',
    region: 'المنطقة',
    clearFilters: 'مسح الفلاتر',
    deviceTypeMismatchError: 'نوع الجهاز المحدد لا يتطابق مع النوع المسجل مسبقًا في النظام.',
    close: 'إغلاق',
    canLoginNow: 'يمكنك الآن تسجيل الدخول.',
    invalidRegistrationIdFormat: 'رقم الهوية غير صالح. يجب أن يكون 10 أرقام.',
    printErrorTitle: 'خطأ في الطباعة',
    printErrorMessage: 'حدث خطأ أثناء طباعة الشهادة.',
    ownershipErrorTitle: 'خطأ في الملكية',
    sellerNotOwner: 'البائع ليس المالك المسجل لهذا الجهاز في النظام.',
    buyerNotFound: 'لم يتم العثور على حساب المشتري في النظام.',
    sellerNotFound: 'لم يتم العثور على حساب البائع في النظام.',
    invalidIdLength: 'يجب أن يكون رقم الهوية 10 أرقام.',
    incorrectPhoneNumber: 'رقم الجوال غير صحيح',
    deviceAlreadyReportedStolen: 'هذا الجهاز مبلغ عنه كمسروق بالفعل.',
    reporterNotOwnerError: 'لا يمكن إتمام البلاغ. رقم هوية المُبلِّغ لا يتطابق مع بيانات مالك الجهاز المسجلة.',
    reporterPhoneMismatchError: 'رقم الجوال المُدخل لا يتطابق مع رقم جوال مالك الجهاز المسجل.',
    certificateNumber: 'رقم الشهادة',
    certificateOfPurchase: 'شهادة شراء جهاز إلكتروني',
    buyerInfo: 'بيانات المشتري',
    forBuyer: 'للمشتري',
    forBuyerText: 'يجب فحص كل جهاز قبل الشراء للتأكد من أنه سليم وتسجيل بيانات العملية.',
    deviceSafeForTransaction: 'الجهاز صالح للشراء أو البيع',
    sellerPhoneIncorrect: 'خطأ رقم جوال البائع غير صحيح',
    deviceAlreadyRegisteredToOther: 'لا يمكنك تسجيل الجهاز بسبب انه مسجل لشخص آخر',
    noDevicesFound: 'لا توجد أجهزة مسجلة باسمك حالياً',
  },
  en: {
    checkDevice: 'Check Device',
    reportTheft: 'Report Theft',
    buyDevice: 'Purchase Device',
    manageReports: 'Manage Reports',
    myAccount: 'My Account',
    myProfile: 'My Profile',
    loadingData: 'Loading data...',
    checkSerialTitle: 'Check Serial Number',
    serialNumberLabel: 'Serial Number (IMEI/Serial)',
    serialNumberPlaceholder: 'Enter serial number',
    checkNowButton: 'Check Device Now',
    checking: 'Checking...',
    checkingDevice: 'Checking device, please wait...',
    checkResultTitle: 'Check Result',
    enterSerialToStart: 'Enter a serial number to start the check',
    resultWillShow: 'The result will show here whether the device is safe or stolen',
    safeDeviceTitle: '✅ Safe Device',
    unknownDeviceTitle: 'ℹ️ Unregistered Device',
    deviceNotRegisteredMessage: 'No record was found for this device — no theft report and no registered purchase certificate. This does not necessarily mean the device is safe, only that it is not registered in the system. Verify the device\'s source carefully before buying.',
    existingCertificate: 'A purchase certificate was found for this device:',
    buyerName: 'Buyer Name',
    issueDate: 'Issue Date',
    stolenDeviceTitle: '🚨 Stolen Device',
    warningDeviceStolen: 'Warning: This device is reported as stolen',
    reportRegistrationDate: 'Report Registration Date',
    location: 'Location',
    theftDate: 'Theft Date',
    theftLocation: 'Theft Location',
    reportTo911: 'You must report immediately to 911',
    call911: 'Call Police (911)',
    emergencyCall: 'Emergency Call',
    legalWarningTitle: 'Important Legal Warning',
    legalWarningText: 'According to Saudi regulations, checking the serial number is mandatory before purchasing any electronic device. Failure to do so may expose you to legal liability if the device is proven to be stolen.',
    reportTheftTitle: 'Report a Stolen Device',
    reporterNationalId: 'ID Number',
    reporterPhone: 'Mobile Number (05xxxxxxxx)',
    selectDeviceType: 'Select Device Type',
    devicePhone: 'Smartphone',
    deviceLaptop: 'Laptop',
    deviceTablet: 'Tablet',
    deviceWatch: 'Smartwatch',
    deviceCamera: 'Camera',
    deviceOther: 'Other',
    theftDetails: 'Additional Details',
    sending: 'Sending...',
    submitReportButton: 'Submit Report',
    reportSuccessTitle: 'Report Submitted',
    reportSuccessMessage: 'Your report has been successfully registered.',
    reportErrorTitle: 'Error',
    reportErrorMessage: 'An error occurred. The serial number may already be registered.',
    errorTitle: 'Error',
    validationErrorTitle: 'Data Error',
    invalidPhoneError: 'Mobile number must be 10 digits and start with 05.',
    sameBuyerSellerError: 'Buyer ID cannot be the same as Seller ID.',
    invalidLocationError: 'Theft location is invalid, it cannot contain only numbers.',
    invalidLocationSelection: 'Please select the full location (Region, City, District)',
    buyDeviceTitle: 'Check & Register a Device Purchase',
    forBuyers: 'For Buyers',
    forBuyersText: 'Every device must be checked before purchase to ensure it is not stolen and the transaction data must be registered.',
    buyerId: 'Buyer ID Number',
    sellerId: 'Seller ID Number',
    sellerPhone: 'Seller Mobile Number',
    purchasePrice: 'Purchase Price',
    processing: 'Processing...',
    checkAndRegisterButton: 'Check and Register Transaction',
    certificateIssuedTitle: 'Certificate Issued',
    certificateIssuedMessage: 'The device has been checked and a certificate has been issued successfully.',
    certificateErrorTitle: 'Certificate Issuance Error',
    certificateErrorMessage: 'An error occurred while issuing the certificate.',
    adminWelcome: 'Welcome to the Admin Dashboard.',
    deviceType: 'Device Type',
    status: 'Status',
    statusActive: 'Active',
    statusClosed: 'Closed',
    statusPending_closure: 'Pending Closure',
    underDevelopment: 'Under development...',
    selectIdType: 'Select Reporter ID Type *',
    reporterIdTypeLabel: 'Reporter ID Type',
    buyerIdType: 'Buyer ID Type *',
    sellerIdType: 'Seller ID Type *',
    idNational: 'National ID',
    idResident: 'Residency ID (Iqama)',
    idCommercial: 'Commercial Registration',
    printCertificate: 'Print Certificate',
    buyThisDevice: 'Purchase This Device',
    adminAccessDenied: 'Access denied. This page is for administrators only.',
    adminLoginTitle: 'Admin Login',
    username: 'Username',
    password: 'Password',
    enterUsername: 'Enter username',
    enterPassword: 'Enter password',
    login: 'Login',
    logging_in: 'Logging in...',
    adminLoginErrorTitle: 'Login Error',
    adminLoginError: 'Incorrect username or password',
    adminLoginDisclaimer: 'This section is for authorized administrators only',
    theftReports: 'Theft Reports',
    certificates: 'Certificates',
    searchPlaceholder: 'Enter search term...',
    search: 'Search',
    noResults: 'No results found.',
    noReportsFound: 'No reports match the search criteria.',
    actions: 'Actions',
    editReport: 'Edit Report',
    save: 'Save',
    markClosed: 'Mark as Closed',
    deleteReport: 'Delete Report',
    deleteConfirmation: 'Are you sure you want to delete this report? This action cannot be undone.',
    deletePassword: 'Delete Password',
    deleteReason: 'Delete Reason',
    deleteReasonPlaceholder: 'Enter reason for deleting report...',
    confirmDelete: 'Confirm Delete',
    deletePasswordError: 'Incorrect password.',
    deleteReasonRequired: 'Delete reason is required.',
    deleteErrorMessage: 'An error occurred during deletion.',
    deleteSuccess: 'Deleted successfully.',
    deleteCertificate: 'Delete Certificate',
    deleteCertificateConfirm: 'Do you want to delete the certificate?',
    idType: 'ID Type',
    idNumber: 'ID Number',
    sellerInfo: 'Seller Information',
    phoneNumber: 'Mobile Number',
    deviceInfo: 'Device Information',
    currency: 'SAR',
    certificateDisclaimer: 'Confirmation: The device has been checked on the issue date and no notifications were found on the serial number.',
    edit: 'Edit',
    delete: 'Delete',
    reportActions: 'Report Actions',
    publicSecurity: 'Public Security - Kingdom of Saudi Arabia',
    scanToVerify: 'Scan QR to verify certificate',
    rightsReserved: 'All rights reserved',
    searchCertificates: 'Search Certificates',
    searchReports: 'Search Reports',
    dir: 'ltr',
    lang: 'en',
    locale: 'en-US',
    qrUrlInfo: 'Scan QR or enter URL:',
    atTime: 'at',
    certificateIssueConfirmation: 'This certificate was issued on',
    phoneValidationHint: 'Must be 10 digits and start with 05',
    invalidPhoneErrorSpecific: 'Invalid mobile number. Must be 10 digits and start with 05.',
    invalidLocationErrorSpecific: 'Invalid theft location. Must contain letters (cannot be numbers only).',
    updateReportErrorMessage: 'Failed to update report. Please check the data and try again.',
    reportId: 'Report ID',
    copyReportId: 'Copy Report ID',
    copied: 'Copied',
    id_or_phone_placeholder: 'ID or Mobile Number',
    allFieldsRequired: 'All fields are required',
    oneNewReport: 'There is one new report',
    newReportsAlert: 'There are',
    newReports: 'new reports',
    userLoginTitle: 'User Login',
    addDevice: 'Add Device',
    deviceAddedSuccess: 'Device added successfully',
    deviceAlreadyRegistered: 'This serial number is already registered',
    deviceReportedStolen: 'Cannot add this device as it is reported stolen',
    addNewDeviceTitle: 'Add a New Device You Own',
    serialNumber: 'Serial Number',
    add: 'Add',
    register: 'Register New Account',
    nationalId: 'National ID Number',
    fullName: 'Full Name',
    confirmPassword: 'Confirm Password',
    enterFullName: 'Enter full name',
    passwordRequirements: 'At least 8 characters, with at least one letter and one number',
    confirmPasswordPlaceholder: 'Re-enter password',
    forgotPassword: 'Forgot Password?',
    resetPassword: 'Reset Password',
    resetPasswordInstructions: 'Enter your ID number and mobile number to reset your password',
    back: 'Back',
    cancel: 'Cancel',
    registering: 'Registering...',
    resetting: 'Resetting...',
    loginError: 'Incorrect username or password',
    registerSuccess: 'Account registered successfully. You can now log in',
    registerError: 'Error registering account',
    resetPasswordSuccess: 'A new password has been sent to your mobile number',
    resetPasswordError: 'Error resetting password',
    invalidPasswordError: 'Password must be at least 8 characters long and include a letter and a number',
    passwordMismatchError: 'Passwords do not match',
    sellDeviceTitle: 'Sell Device',
    sellingDeviceInfo: 'Information of the device to be sold',
    originalDeviceType: 'Original Device Type',
    confirmDeviceType: 'Confirm Device Type',
    sellDevice: 'Sell Device',
    confirmSale: 'Confirm Sale',
    selectDeviceTypeForSale: 'Select the device type to confirm the sale',
    enterBuyerId: 'Buyer ID Number',
    enterPurchasePrice: 'Sale Price',
    cannotSellToYourself: 'You cannot sell a device to yourself',
    deviceSoldSuccess: 'Device sold successfully and a new certificate has been issued to the buyer',
    sellDeviceError: 'Error selling device',
    buyerAccountNotFound: 'Cannot complete the sale. No account found with the buyer\'s ID number',
    sellingDevice: 'Selling...',
    salePrice: 'Sale Price',
    buyerIdLabel: 'Buyer ID Number',
    sellThisDevice: 'Sell This Device',
    confirmDeviceSale: 'Confirm Device Sale',
    deviceTypeMustMatch: 'The selected device type must match the registered type',
    theftReportSuccess: 'Theft reported successfully',
    reportTheftError: 'Error reporting theft',
    logout: 'Logout',
    myDevices: 'My Devices',
    myReports: 'My Reports',
    devicesYouOwn: 'Devices You Own',
    yourTheftReports: 'Your Theft Reports',
    editProfile: 'Edit Profile',
    changePassword: 'Change Password',
    changePasswordNote: 'Leave blank if you do not want to change the password',
    currentPassword: 'Current Password',
    newPassword: 'New Password',
    cannotChangeNationalId: 'National ID number cannot be changed',
    saveChanges: 'Save Changes',
    saving: 'Saving...',
    userInfoUpdated: 'Information updated successfully',
    updateSuccessTitle: 'Update Successful',
    updateError: 'Error updating information',
    updateErrorTitle: 'Update Error',
    userNotFound: 'User not found or data is incorrect.',
    userAlreadyExists: 'The ID number or mobile number is already registered.',
    passwordIncorrectError: 'Current password is incorrect.',
    invalidPriceError: 'Purchase price must be a positive number greater than zero',
    buyerAccountRequired: 'Cannot complete purchase. The buyer must have a registered account in the system with the entered ID number.',
    invalidBuyerIdLength: 'Buyer ID must be exactly 10 digits.',
    invalidIdFormat: 'Invalid ID number. Must be 10 digits and start with 1 (National ID), 2 (Residency ID), or 7 (Commercial Reg).',
    invalidIdOrPhoneFormat: 'Invalid ID or mobile number format.',
    verifying: 'Verifying...',
    verifyButton: 'Verify',
    enterNewPassword: 'Please enter the new password.',
    passwordResetSuccess: 'Password reset successfully. You can now log in.',
    backToLogin: 'Back to Login',
    active: 'Active',
    transferred: 'Transferred',
    viewHistory: 'View History',
    certificateHistory: 'Device Certificate History',
    requestClosure: 'Request Report Closure',
    requestClosureForReport: 'Request to Close Report',
    closureReason: 'Reason for Closing',
    deviceFound: 'Device was found',
    otherReason: 'Other reason',
    pleaseSpecify: 'Please specify',
    enterOtherReason: 'Please write the reason here...',
    submitRequest: 'Submit Request',
    requestSent: 'Request Sent',
    closureRequestSubmitted: 'Report closure request has been sent successfully. It will be reviewed by an administrator.',
    closureRequestError: 'An error occurred while sending the closure request.',
    reasonRequiredWhenOther: 'Reason is required when selecting "Other reason".',
    userClosureRequest: 'Closure Request from User',
    reasonLabel: 'Reason',
    detailsLabel: 'Details',
    approveClosure: 'Approve Closure',
    rejectClosure: 'Reject Closure',
    filterByRegion: 'Filter by Region',
    filterByDeviceType: 'Filter by Device Type',
    allRegions: 'All Regions',
    allDeviceTypes: 'All Device Types',
    easternRegion: 'Eastern Province',
    riyadhRegion: 'Riyadh Province',
    makkahRegion: 'Makkah Province',
    madinahRegion: 'Madinah Province',
    qassimRegion: 'Qassim Province',
    hailRegion: 'Hail Province',
    northernBordersRegion: 'Northern Borders Province',
    joufRegion: 'Jouf Province',
    tabukRegion: 'Tabuk Province',
    najranRegion: 'Najran Province',
    jazanRegion: 'Jazan Province',
    asirRegion: 'Asir Province',
    bahahRegion: 'Bahah Province',
    activeFilters: 'Active Filters',
    searchText: 'Search Text',
    region: 'Region',
    clearFilters: 'Clear Filters',
    deviceTypeMismatchError: 'The selected device type does not match the type previously registered in the system.',
    close: 'Close',
    canLoginNow: 'You can now log in.',
    invalidRegistrationIdFormat: 'Invalid ID number. Must be 10 digits.',
    printErrorTitle: 'Print Error',
    printErrorMessage: 'An error occurred while printing the certificate.',
    ownershipErrorTitle: 'Ownership Error',
    sellerNotOwner: 'The seller is not the registered owner of this device in the system.',
    buyerNotFound: 'Buyer account not found in the system.',
    sellerNotFound: 'Seller account not found in the system.',
    invalidIdLength: 'ID number must be 10 digits.',
    incorrectPhoneNumber: 'Incorrect mobile number',
    deviceAlreadyReportedStolen: 'This device is already reported as stolen.',
    reporterNotOwnerError: 'Cannot complete report. Reporter\'s ID does not match the registered owner\'s data.',
    reporterPhoneMismatchError: 'The entered mobile number does not match the registered owner\'s mobile number.',
    certificateNumber: 'Certificate Number',
    certificateOfPurchase: 'Electronic Device Purchase Certificate',
    buyerInfo: 'Buyer Information',
    forBuyer: 'For the Buyer',
    forBuyerText: 'Every device must be checked before purchase to ensure it is sound and the transaction data must be registered.',
    deviceSafeForTransaction: 'The device is safe for purchase or sale',
    sellerPhoneIncorrect: 'Error: Seller\'s mobile number is incorrect',
    deviceAlreadyRegisteredToOther: 'You cannot register this device because it is registered to another person',
    noDevicesFound: 'You currently have no registered devices',
  }
};
