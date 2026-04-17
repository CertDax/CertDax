import { useEffect, useState, useRef, useCallback } from 'react';
import { Bell, CheckCheck, ShieldCheck, AlertTriangle, XCircle, Info, X, BellRing, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { Notification } from '../types';

const POLL_INTERVAL = 10_000;
const TOAST_DURATION = 6_000;

function getNotificationIcon(type: string, size = 'w-4 h-4') {
  switch (type) {
    case 'cert_issued':
      return <ShieldCheck className={`${size} text-emerald-500 shrink-0`} />;
    case 'cert_renewed':
      return <ShieldCheck className={`${size} text-blue-500 shrink-0`} />;
    case 'cert_expired':
      return <AlertTriangle className={`${size} text-amber-500 shrink-0`} />;
    case 'cert_error':
      return <XCircle className={`${size} text-red-500 shrink-0`} />;
    default:
      return <Info className={`${size} text-slate-400 shrink-0`} />;
  }
}

interface Toast {
  id: number;
  notification: Notification;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const navigate = useNavigate();

  // Show custom permission prompt after 2s if not yet answered
  useEffect(() => {
    if ('Notification' in window && window.Notification.permission === 'default') {
      const choice = localStorage.getItem('certdax-notif-prompt-choice');
      if (!choice) {
        const timer = setTimeout(() => setShowPermissionPrompt(true), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleAllowNotifications = () => {
    if ('Notification' in window) {
      window.Notification.requestPermission().then(() => {
        setShowPermissionPrompt(false);
        localStorage.setItem('certdax-notif-prompt-choice', 'allowed');
      });
    }
  };

  const handleDismissPrompt = () => {
    setShowPermissionPrompt(false);
    localStorage.setItem('certdax-notif-prompt-choice', 'dismissed');
  };

  const addToast = useCallback((notif: Notification) => {
    const toastId = Date.now();
    setToasts((prev) => [...prev, { id: toastId, notification: notif }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, TOAST_DURATION);
  }, []);

  const removeToast = useCallback((toastId: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const fetchUnreadCount = useCallback(() => {
    api.get('/notifications?limit=5')
      .then(({ data: notifs }) => {
        // Count unread
        const unread = notifs.filter((n: Notification) => !n.is_read).length;
        // Also fetch full unread count from server
        api.get('/notifications/unread-count').then(({ data }) => {
          setUnreadCount(data.unread);
        }).catch(() => setUnreadCount(unread));

        // Detect new notifications by checking if the latest ID changed
        if (notifs.length > 0) {
          const latestId = notifs[0].id;
          if (lastSeenIdRef.current !== null && latestId > lastSeenIdRef.current) {
            // Find all new notifications we haven't seen
            const newNotifs = notifs.filter(
              (n: Notification) => n.id > (lastSeenIdRef.current ?? 0) && !n.is_read
            );
            for (const notif of newNotifs.slice(0, 3)) {
              addToast(notif);
              if ('Notification' in window && window.Notification.permission === 'granted') {
                new window.Notification(notif.title, {
                  body: notif.message,
                  icon: '/favicon.ico',
                  tag: `certdax-${notif.id}`,
                });
              }
            }
          }
          lastSeenIdRef.current = latestId;
        }
      })
      .catch(() => {});
  }, [addToast]);

  const fetchNotifications = useCallback(() => {
    api.get('/notifications?limit=20')
      .then(({ data }) => setNotifications(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) fetchNotifications();
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

  const clearRead = () => {
    api.delete('/notifications/read').then(() => {
      setNotifications((prev) => prev.filter((n) => !n.is_read));
      fetchUnreadCount();
    });
  };

  const handleClick = (notif: Notification) => {
    if (!notif.is_read) markRead(notif.id);
    if (notif.resource_id) {
      const basePath = notif.resource_type === 'self_signed' ? '/self-signed' : '/certificates';
      navigate(`${basePath}/${notif.resource_id}`);
      setOpen(false);
    }
  };

  return (
    <>
      {/* Bell button + dropdown */}
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
          <div className="fixed inset-x-0 top-16 mx-2 sm:absolute sm:inset-x-auto sm:top-auto sm:mx-0 sm:right-0 sm:mt-2 w-auto sm:w-[28rem] bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
              <div className="flex items-center gap-3">
                {notifications.some((n) => n.is_read) && (
                  <button
                    onClick={clearRead}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear read
                  </button>
                )}
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
                      <p className="text-xs text-slate-500 mt-0.5 break-words">{notif.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-slate-400">
                          {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                        </span>
                        <span className="text-[11px] text-slate-300">&middot;</span>
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

      {/* Fixed bottom-right toast container */}
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[9999] flex flex-col gap-3 pointer-events-none">
        {/* Browser notification permission prompt */}
        {showPermissionPrompt && (
          <div className="pointer-events-auto bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-full sm:w-80 animate-[slideUp_0.3s_ease-out]">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                <BellRing className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-slate-900">Enable notifications</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Get notified when certificates are renewed, expire, or encounter errors.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={handleAllowNotifications}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    Allow
                  </button>
                  <button
                    onClick={handleDismissPrompt}
                    className="px-3 py-1.5 text-slate-500 text-xs font-medium rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    Not now
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismissPrompt}
                className="text-slate-400 hover:text-slate-600 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* In-app toast notifications */}
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => {
              handleClick(toast.notification);
              removeToast(toast.id);
            }}
            className="pointer-events-auto bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-full sm:w-96 cursor-pointer hover:bg-slate-50 transition-colors animate-[slideUp_0.3s_ease-out]"
          >
            <div className="flex items-start gap-3">
              {getNotificationIcon(toast.notification.type, 'w-5 h-5')}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 break-words">{toast.notification.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 break-words">{toast.notification.message}</p>
                <p className="text-[11px] text-slate-400 mt-1">{toast.notification.actor}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeToast(toast.id);
                }}
                className="text-slate-400 hover:text-slate-600 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
