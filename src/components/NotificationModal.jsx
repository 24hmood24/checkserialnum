
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function NotificationModal({ isOpen, onClose, title, children, status = 'default' }) {
  const statusClasses = {
    success: 'from-green-500 to-emerald-600',
    danger: 'from-red-500 to-rose-600',
    warning: 'from-amber-500 to-orange-600',
    default: 'from-blue-500 to-indigo-600',
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none max-w-lg" dir="rtl">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <DialogHeader className={`p-6 text-white rounded-t-lg bg-gradient-to-br ${statusClasses[status]}`}>
            <DialogTitle className="text-center text-2xl font-bold">{title}</DialogTitle>
          </DialogHeader>
          <div className="p-6 md:p-8 text-right">
            {children}
          </div>
          <DialogFooter className="p-4 bg-gray-50 border-t">
            <Button onClick={onClose} variant="outline">Close</Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
