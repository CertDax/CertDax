import { useEffect, useState, useRef, useCallback } from 'react';
import { Bell, CheckCheck, ShieldCheck, AlertTriangle, XCircle, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { Notification } from '../types';

const POLL_INTERVAL = 30_000;

function requestBrowserPermission() {
  if ('Notification' in window && window.Notification.permission === 'default') {
    window.Notification.requestPermission();
  }
}

function showBrowserNotification(notif: Notification) {
  if ('Notification' in window && window.Notification.permission === 'granted') {
    new window.Notification(notif.title, {
      body: notif.message,
      icon: '/favicon.ico',
      tag: `certdax-${notif.id}`,
    });
  }
}

function getNotificationIcon(type: string) {
  switch (type) {
    case 'cert_issued':
      return <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />;
    case 'cert_renewed':
      return <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0" />;
    case 'cert_expired':
      return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
    case 'cert_error':
      return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-slate-400 shrink-0" />;
  }
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const fetchUnreadCount = useCallback(() => {
    api.get('/notifications/unread-count')
      .then(({ data }) => {
        const newCount = data.unread;
        // Detect new notifications arriving
        if (prevUnreadRef.current !== null && newCount > prevUnreadRef.current) {
          // Fetch latest to show browser notification
          api.get('/notifications?limit=5').then(({ data: notifs }) => {
            const latest = notifs.find((n: Notification) => !n.is_read);
            if (latest) showBrowserNotification(latest);
          });
        }
        prevUnreadRef.current = newCount;
        setUnreadCount(newCount);
      })
      .catch(() => {});
  }, []);

  const fetchNotifications = useCallback(() => {
    api.get('/notifications?limit=20')
      .then(({ data }) => setNotifications(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestBrowserPermission();
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllRead = () => {
    api.post('/notifications/mark-all-read').then(() => {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    });
  };

  const markRead = (id: number) => {
    api.post(`/notifications/${id}/read`).then(() => {
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    });
  };

  const handleClick = (notif: Notification) => {
    if (!notif.is_read) markRead(notif.id);
    if (notif.resource_id) {
      const basePath = notif.resource_type === 'selfsigned' ? '/self-signed' : '/certificates';
      navigate(`${basePath}/${notif.resource_id}`);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-500 hover:text-slate-700 transition-colors rounded-lg hover:bg-slate-100"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No notifications yet
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 ${
                    !notif.is_read ? 'bg-emerald-50/50' : ''
                  }`}
                >
                  <div className="mt-0.5">
                    {getNotificationIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm ${!notif.is_read ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                        {notif.title}
                      </p>
                      {!notif.is_read && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{notif.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-slate-400">
                        {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                      </span>
                      <span className="text-[11px] text-slate-300">·</span>
                      <span className="text-[11px] text-slate-400">{notif.actor}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
