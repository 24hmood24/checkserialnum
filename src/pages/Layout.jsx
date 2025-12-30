

import React, { useState, useEffect } from 'react';
import { User, Globe, Settings, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import Home from '@/pages/Home';
import UserLoginModal from '@/components/UserLoginModal';

export default function Layout({ children }) {
  const [showUserLogin, setShowUserLogin] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [userType, setUserType] = useState(null);
  const [lang, setLang] = useState('ar'); // Add language state

  useEffect(() => {
    // Check for existing session
    const storedUser = localStorage.getItem('loggedInUser');
    const storedUserType = localStorage.getItem('userType');
    const storedLang = localStorage.getItem('appLang') || 'ar';

    if (storedUser && storedUserType) {
      setLoggedInUser(JSON.parse(storedUser));
      setUserType(storedUserType);
    }
    setLang(storedLang);
  }, []);

  // Listen for login events from other components so Layout updates without reload
  useEffect(() => {
    const onLogin = (e) => {
      const d = e && e.detail;
      if (d && d.user) {
        setLoggedInUser(d.user);
        setUserType(d.userType || null);
      }
    };
    window.addEventListener('app:login', onLogin);
    return () => window.removeEventListener('app:login', onLogin);
  }, []);

  const handleLanguageChange = () => {
    const newLang = lang === 'ar' ? 'en' : 'ar';
    setLang(newLang);
    localStorage.setItem('appLang', newLang);
  };

  const handleUserLoginClick = () => {
    setShowUserLogin(true);
  };

  const handleUserLogout = () => {
    setLoggedInUser(null);
    setUserType(null);
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('userType');
  };

  const pageWithProps = React.cloneElement(children, {
    showUserLogin,
    setShowUserLogin,
    loggedInUser,
    setLoggedInUser,
    userType,
    setUserType,
    lang // Pass language to child components
  });

  return (
    <>
      <style>{`
        .body-bg {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .gradient-bg-header {
          background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #06b6d4 100%);
          position: relative;
          overflow: hidden;
        }
        .gradient-bg-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
          animation: float 20s ease-in-out infinite;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .floating-animation {
          animation: floating 6s ease-in-out infinite;
        }
        @keyframes floating {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .pulse-animation {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .success-glow {
          box-shadow: 0 0 30px rgba(34, 197, 94, 0.3);
        }
        .danger-glow {
          box-shadow: 0 0 30px rgba(239, 68, 68, 0.3);
        }
        /* Mobile viewport fix */
        @media (max-width: 768px) {
          html, body {
            overflow-x: hidden;
            -webkit-tap-highlight-color: transparent;
          }
          .container {
            padding-left: 1rem;
            padding-right: 1rem;
          }
        }
      `}</style>
      <div className="body-bg min-h-screen" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <header className="gradient-bg-header text-white shadow-2xl relative z-10">
          <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 sm:space-x-4 space-x-reverse">
                <img src="/logo.svg" alt="Logo" className="w-20 h-20 sm:w-28 sm:h-28 object-contain" />
                <div className="relative z-10">
                  <h1 className="mb-1 text-base font-bold sm:text-3xl sm:mb-2 drop-shadow-lg">
                    {lang === 'ar' ? 'نظام فحص الأجهزة' : 'Device Check System'}
                  </h1>
                  <p className="text-xs font-normal no-underline sm:text-lg">
                    {lang === 'ar' ? 'الأمن العام - المملكة العربية السعودية' : 'Public Security - Kingdom of Saudi Arabia'}
                  </p>
                </div>
              </div>
              <div className="text-left relative z-10 flex flex-col gap-2">
                <div className="bg-white bg-opacity-20 backdrop-blur-sm rounded-xl p-2 sm:p-4 border border-white border-opacity-30">
                  <p className="text-xs sm:text-sm text-white text-opacity-80 mb-1">
                    {lang === 'ar' ? 'خط المساعدة' : 'Help Line'}
                  </p>
                  <p className="text-base sm:text-2xl font-bold text-white mb-2 sm:mb-3">911</p>

                  {/* Show login button only when user is not logged in */}
                  {!loggedInUser &&
                    <Button onClick={handleUserLoginClick} className="bg-white bg-opacity-30 hover:bg-opacity-40 text-white px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-300 hover:scale-105 backdrop-blur-sm border border-white border-opacity-20 w-full">
                      <Settings className="ml-1 sm:ml-2 h-3 sm:h-4 w-3 sm:w-4" />
                      {lang === 'ar' ? 'تسجيل دخول' : 'Login'}
                    </Button>
                  }
                </div>

                {/* Language toggle button */}
                <div className="flex gap-2">
                  {loggedInUser && userType === 'admin' && (
                    <a href="/admin-seed" className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-300">
                      Admin
                    </a>
                  )}
                  <Button
                    onClick={handleLanguageChange}
                    variant="outline"
                    size="sm"
                    className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-300 hover:scale-105 backdrop-blur-sm border border-white border-opacity-20 flex items-center gap-1 sm:gap-2">

                    <Globe className="w-3 sm:w-4 h-3 sm:h-4" />
                    <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-grow">
          {pageWithProps}
        </main>

        <footer className="bg-gray-800/50 backdrop-blur-sm text-white py-4 sm:py-6 mt-8 sm:mt-12 border-t border-white/20">
          <div className="container mx-auto px-2 sm:px-4 text-center">
            <p className="mb-1 sm:mb-2 text-sm sm:text-base">
              {lang === 'ar' ?
                `الأمن العام - المملكة العربية السعودية ${new Date().getFullYear()}` :
                `Public Security - Kingdom of Saudi Arabia ${new Date().getFullYear()}`
              }
            </p>
            <p className="text-gray-300 text-xs sm:text-sm">
              {lang === 'ar' ?
                'جميع الحقوق محفوظة | للاستفسارات: 911' :
                'All Rights Reserved | For inquiries: 911'
              }
            </p>
          </div>
        </footer>
      </div>
    </>);

}

