import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';

const content = {
  ar: {
    title: 'سياسة الخصوصية',
    close: 'إغلاق',
    sections: [
      {
        h: 'مقدمة',
        p: 'هذا مشروع تجريبي/تعليمي مستقل وغير تابع لأي جهة حكومية رسمية. توضح هذه السياسة نوع البيانات التي يجمعها الموقع وكيفية استخدامها.'
      },
      {
        h: 'البيانات التي نجمعها',
        p: 'عند استخدام النماذج المتاحة (فحص جهاز، الإبلاغ عن سرقة، تسجيل عملية شراء، إنشاء حساب) قد نجمع: رقم الهوية الوطنية أو الإقامة، رقم الجوال، الاسم، نوع الجهاز والرقم التسلسلي، وتفاصيل نصية تكتبها بنفسك.'
      },
      {
        h: 'الغرض من الجمع',
        p: 'تُستخدم هذه البيانات فقط لتشغيل وظائف الموقع التجريبية: التحقق من حالة الجهاز، وتسجيل بلاغات السرقة، وإصدار شهادات الشراء، وتسجيل الدخول لحسابك. لا تُستخدم لأي غرض تسويقي أو يتم بيعها لأي جهة خارجية.'
      },
      {
        h: 'تخزين البيانات',
        p: 'البيانات مخزّنة محلياً في هذا البناء التجريبي (localStorage/قاعدة بيانات المشروع) دون تشفير متقدم، وهذا نموذج تعليمي — لا يُنصح بإدخال بيانات حقيقية حساسة.'
      },
      {
        h: 'حقوقك',
        p: 'بما أن هذا مشروع تجريبي، يمكنك التواصل مع صاحب المشروع لطلب حذف أي بيانات أدخلتها.'
      }
    ]
  },
  en: {
    title: 'Privacy Policy',
    close: 'Close',
    sections: [
      {
        h: 'Introduction',
        p: 'This is an independent educational/demo project and is not affiliated with any official government entity. This policy explains what data this site collects and how it is used.'
      },
      {
        h: 'Data We Collect',
        p: 'When using the available forms (device check, theft report, purchase registration, account creation) we may collect: national ID or residency ID number, mobile number, name, device type and serial number, and any free-text details you enter.'
      },
      {
        h: 'Purpose of Collection',
        p: 'This data is used solely to operate the demo features of this site: checking device status, filing theft reports, issuing purchase certificates, and logging into your account. It is never used for marketing or sold to third parties.'
      },
      {
        h: 'Data Storage',
        p: 'Data is stored locally within this demo build (localStorage / the project\'s database) without advanced encryption. This is an educational prototype — please avoid entering real sensitive information.'
      },
      {
        h: 'Your Rights',
        p: 'Since this is a demo project, you can contact the project owner to request deletion of any data you have entered.'
      }
    ]
  }
};

export default function PrivacyPolicyModal({ isOpen, onClose, lang = 'ar' }) {
  const c = content[lang] || content.ar;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center text-xl font-bold">
            <ShieldCheck className="w-6 h-6 ml-2 mr-0 text-blue-600" />
            {c.title}
          </DialogTitle>
        </DialogHeader>
        <div className={`space-y-4 ${lang === 'ar' ? 'text-right' : 'text-left'}`}>
          {c.sections.map((s, i) => (
            <div key={i}>
              <h4 className="font-bold text-gray-800 mb-1">{s.h}</h4>
              <p className="text-sm text-gray-600 leading-relaxed">{s.p}</p>
            </div>
          ))}
        </div>
        <Button onClick={onClose} className="w-full mt-4">{c.close}</Button>
      </DialogContent>
    </Dialog>
  );
}
