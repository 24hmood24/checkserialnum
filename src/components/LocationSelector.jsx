
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input'; // <-- Import Input component

const saudiLocations = {
    'الرياض': {
        en: 'Riyadh Region',
        cities: {
            'الرياض': { en: 'Riyadh' },
            'الدرعية': { en: 'Diriyah' },
            'الخرج': { en: 'Al-Kharj' },
            'المجمعة': { en: 'Al-Majmaah' },
            'الدوادمي': { en: 'Dawadmi' },
            'القويعية': { en: 'Al Quwaiiyah' },
            'عفيف': { en: 'Afif' },
            'وادي الدواسر': { en: 'Wadi ad-Dawasir' },
        }
    },
    'مكة المكرمة': {
        en: 'Makkah Region',
        cities: {
            'مكة': { en: 'Makkah' },
            'جدة': { en: 'Jeddah' },
            'الطائف': { en: 'Taif' },
            'رابغ': { en: 'Rabigh' },
            'القنفذة': { en: 'Al Qunfudhah' },
            'الليث': { en: 'Al Lith' },
            'الجموم': { en: 'Al Jumum' },
        }
    },
    'المدينة المنورة': {
        en: 'Madinah Region',
        cities: {
            'المدينة المنورة': { en: 'Madinah' },
            'ينبع': { en: 'Yanbu' },
            'العلا': { en: 'Al-Ula' },
            'بدر': { en: 'Badr' },
            'خيبر': { en: 'Khaybar' },
        }
    },
    'الشرقية': {
        en: 'Eastern Region',
        cities: {
            'الدمام': { en: 'Dammam' },
            'الخبر': { en: 'Khobar' },
            'الظهران': { en: 'Dhahran' },
            'الجبيل': { en: 'Jubail' },
            'حفر الباطن': { en: 'Hafar Al-Batin' },
            'الأحساء': { en: 'Al-Ahsa' },
            'القطيف': { en: 'Qatif' },
            'رأس تنورة': { en: 'Ras Tanura' },
        }
    },
    'عسير': {
        en: 'Asir Region',
        cities: {
            'أبها': { en: 'Abha' },
            'خميس مشيط': { en: 'Khamis Mushait' },
            'بيشة': { en: 'Bisha' },
            'النماص': { en: 'An-Namas' },
        }
    },
    'تبوك': {
        en: 'Tabuk Region',
        cities: {
            'تبوك': { en: 'Tabuk' },
            'الوجه': { en: 'Al Wajh' },
            'ضباء': { en: 'Duba' },
        }
    },
    'القصيم': {
        en: 'Qassim Region',
        cities: {
            'بريدة': { en: 'Buraidah' },
            'عنيزة': { en: 'Unaizah' },
            'الرس': { en: 'Ar Rass' },
            'البكيرية': { en: 'Al-Bukayriyah' },
        }
    },
    'حائل': {
        en: 'Hail Region',
        cities: {
            'حائل': { en: 'Hail' },
            'بقعاء': { en: 'Baqaa' },
        }
    },
    'جازان': {
        en: 'Jazan Region',
        cities: {
            'جازان': { en: 'Jazan' },
            'صبيا': { en: 'Sabya' },
            'أبو عريش': { en: 'Abu Arish' },
            'صامطة': { en: 'Samtah' },
        }
    },
    'نجران': {
        en: 'Najran Region',
        cities: {
            'نجران': { en: 'Najran' },
        }
    },
    'الباحة': {
        en: 'Al-Bahah Region',
        cities: {
            'الباحة': { en: 'Al-Bahah' },
            'بلجرشي': { en: 'Baljurashi' },
        }
    },
    'الجوف': {
        en: 'Al-Jouf Region',
        cities: {
            'سكاكا': { en: 'Sakaka' },
            'دومة الجندل': { en: 'Dumat Al-Jandal' },
        }
    },
    'الحدود الشمالية': {
        en: 'Northern Borders Region',
        cities: {
            'عرعر': { en: 'Arar' },
            'رفحاء': { en: 'Rafha' },
        }
    },
};

const ClickDropdown = ({ placeholder, value, onValueChange, items, lang }) => {
  const displayValue = value || placeholder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal bg-slate-200 border-input h-10 px-3 py-2 text-right"
          disabled={items.length === 0}
        >
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
            {displayValue}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto"
        align="start"
      >
        {items.map(item => (
          <DropdownMenuItem
            key={item.value}
            onSelect={() => onValueChange(item.value)}
            className="justify-end"
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default function LocationSelector({ value, onChange, lang, required }) {
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');

  useEffect(() => {
    if (value) {
      const [vRegion, vCity, vDistrict] = value.split(' - ');
      if (vRegion && saudiLocations[vRegion]) {
        setRegion(vRegion);
      } else {
        setRegion('');
      }

      if (vRegion && vCity && saudiLocations[vRegion]?.cities[vCity]) {
        setCity(vCity);
      } else {
        setCity('');
      }
      
      // District is now a free text field, so we just set it if present.
      if (vDistrict) {
        setDistrict(vDistrict);
      } else {
        setDistrict('');
      }
    } else {
        setRegion('');
        setCity('');
        setDistrict('');
    }
  }, [value]);

  const handleRegionChange = (newRegion) => {
    setRegion(newRegion);
    setCity('');
    setDistrict('');
    onChange('');
  };

  const handleCityChange = (newCity) => {
    setCity(newCity);
    setDistrict('');
    onChange('');
  };

  const handleDistrictChange = (e) => {
    const newDistrict = e.target.value;
    setDistrict(newDistrict);
    // Only call onChange if all parts are selected, or clear it if district is empty
    if (region && city && newDistrict.trim()) {
      onChange(`${region} - ${city} - ${newDistrict}`);
    } else {
      onChange('');
    }
  };

  const regionItems = Object.keys(saudiLocations).map(key => ({
    label: lang === 'ar' ? key : saudiLocations[key].en,
    value: key
  }));

  const cityItems = region ? Object.keys(saudiLocations[region].cities).map(key => ({
    label: lang === 'ar' ? key : saudiLocations[region].cities[key].en,
    value: key
  })) : [];
  
  // District items are no longer needed as it's a text input now.

  return (
    <div className="space-y-2">
      <ClickDropdown
        placeholder={lang === 'ar' ? 'المنطقة' : 'Region'}
        value={lang === 'ar' ? region : (saudiLocations[region]?.en || region)}
        onValueChange={handleRegionChange}
        items={regionItems}
        lang={lang}
      />
      <AnimatePresence>
        {region && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ClickDropdown
              placeholder={lang === 'ar' ? 'المدينة' : 'City'}
              value={lang === 'ar' ? city : (saudiLocations[region]?.cities[city]?.en || city)}
              onValueChange={handleCityChange}
              items={cityItems}
              lang={lang}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {city && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Input
              placeholder={lang === 'ar' ? 'اكتب اسم الحي' : 'Type the district name'}
              value={district}
              onChange={handleDistrictChange}
              className="bg-slate-200 border-input h-10 px-3 py-2 text-right w-full"
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              required={required}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {region && city && district && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
          <p className="text-green-800 text-sm">
            <strong>{lang === 'ar' ? 'الموقع المختار:' : 'Selected Location:'}</strong> {region} - {city} - {district}
          </p>
        </div>
      )}
    </div>
  );
}
