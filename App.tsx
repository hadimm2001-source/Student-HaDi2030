import React, { useState, useEffect } from 'react';
import { 
  Users, CheckCircle, XCircle, Clock, Search, Filter, 
  FileSpreadsheet, FileText, Download, Upload, Trash2, 
  MessageSquare, Sparkles, LogOut, ChevronRight, Map as MapIcon, Zap, GraduationCap,
  Printer, Share2, Copy, AlertCircle, Settings, Calendar, FileDown, BarChart3, UserX,
  LayoutGrid, CalendarCheck, User, ShieldCheck, ArrowLeft, Info, HelpCircle, Bell, FilePlus, AlertTriangle,
  Check, X, Eye, BellRing, CheckCircle2, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, getDocs, where, setDoc, writeBatch } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import { toPng } from 'html-to-image';

// --- Types ---
interface Excuse {
  id: string;
  type: string;
  detail: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  fileName?: string;
  fileData?: string;
  notified?: boolean;
}

interface Student {
  id: string;
  name: string;
  phone: string;
  class: string;
  status: 'present' | 'absent' | 'late' | 'excused' | 'none';
  time: string;
  absentCount: number;
  excuses?: Excuse[];
}

interface AttendanceHistory {
  [date: string]: Student[];
}

// --- Constants ---
const ADMIN_PASSWORD = "hadi";
const STORAGE_KEY = 'attendance_saas_data';
const HISTORY_KEY = 'attendance_saas_history';

// --- App Component ---
export default function App() {
  const [view, setView] = useState<'login' | 'admin' | 'student'>('login');
  const [isAdmin, setIsAdmin] = useState(false);
  const [studentPhone, setStudentPhone] = useState('');
  const [loggedInStudent, setLoggedInStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceHistory>({});
  const [importStatus, setImportStatus] = useState<{ loading: boolean, message: string } | null>(null);

  const updateAndSortStudents = (newList: Student[]) => {
    const sorted = [...newList].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    setStudents(sorted);
    return sorted;
  };

  // Load initial data from Firestore for real-time sync
  useEffect(() => {
    if (!db) return;

    const unsubStudents = onSnapshot(collection(db, 'students'), (snapshot) => {
      const studentList: Student[] = [];
      snapshot.forEach(doc => {
        studentList.push(doc.data() as Student);
      });
      updateAndSortStudents(studentList);
      setLoading(false);
    }, (error) => {
      console.error("Firestore students onSnapshot error:", error);
      setLoading(false);
    });

    const unsubHistory = onSnapshot(collection(db, 'history'), (snapshot) => {
      const historyData: AttendanceHistory = {};
      snapshot.forEach(doc => {
        historyData[doc.id] = doc.data().records;
      });
      setAttendanceHistory(historyData);
    }, (error) => {
      console.error("Firestore history onSnapshot error:", error);
    });

    // Migration check (one-time)
    const migrateData = async () => {
      try {
        const { getDoc } = await import('firebase/firestore');
        const stateDoc = await getDoc(doc(db, 'app_data', 'state'));
        if (stateDoc.exists()) {
          const data = stateDoc.data();
          if (data.students && data.students.length > 0) {
            console.log("Migrating students...");
            for (const s of data.students) {
              await setDoc(doc(db, 'students', s.id), s);
            }
          }
          if (data.history && Object.keys(data.history).length > 0) {
            console.log("Migrating history...");
            for (const date in data.history) {
              await setDoc(doc(db, 'history', date), { records: data.history[date] });
            }
          }
        }
      } catch (err) {
        console.error("Migration error:", err);
      }
    };
    migrateData();

    return () => {
      unsubStudents();
      unsubHistory();
    };
  }, []);

  // Save data to Firestore helper with throttling and minimal writes
  const saveData = async (newStudents: Student[], newHistory: AttendanceHistory) => {
    if (!db) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayRecords = newHistory[today];
      if (todayRecords) {
        const minimalRecords = todayRecords.map(s => ({
          id: s.id,
          phone: s.phone,
          status: s.status,
          time: s.time
        }));
        await setDoc(doc(db, 'history', today), { records: minimalRecords }, { merge: true });
      }
    } catch (err) {
      console.error("Error updating Firestore:", err);
    }
  };

  const saveSingleStudent = async (student: Student) => {
    if (!db) return;
    try {
      await setDoc(doc(db, 'students', student.id), student);
    } catch (err) {
      console.error("Error saving student:", err);
    }
  };

  const saveHistoryDay = async (date: string, records: Student[]) => {
    if (!db) return;
    try {
      const minimalRecords = records.map(s => ({
        id: s.id,
        phone: s.phone,
        status: s.status,
        time: s.time
      }));
      await setDoc(doc(db, 'history', date), { records: minimalRecords });
    } catch (err) {
      console.error("Error saving history:", err);
    }
  };

  const updateStatus = (id: string, status: Student['status']) => {
    const time = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    let updatedStudent: Student | null = null;
    
    const newStudents = students.map(s => {
      if (s.id === id) {
        let absentCount = s.absentCount;
        // Increment only if going to absent and not already absent or excused
        if (status === 'absent' && s.status !== 'absent' && s.status !== 'excused') absentCount++;
        // Decrement if leaving absent/excused to something else
        if ((s.status === 'absent' || s.status === 'excused') && (status !== 'absent' && status !== 'excused')) {
          absentCount = Math.max(0, absentCount - 1);
        }
        
        updatedStudent = { ...s, status, time, absentCount };
        return updatedStudent;
      }
      return s;
    });

    updateAndSortStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    
    if (updatedStudent) {
      saveSingleStudent(updatedStudent);
      saveHistoryDay(today, newStudents);
    }
    return updatedStudent; // Return for notification
  };

  const markBulk = (status: Student['status'], filteredIds: string[]) => {
    const time = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    const newStudents = students.map(s => {
      if (filteredIds.includes(s.id)) {
        let absentCount = s.absentCount;
        if (status === 'absent' && s.status !== 'absent' && s.status !== 'excused') absentCount++;
        if ((s.status === 'absent' || s.status === 'excused') && (status !== 'absent' && status !== 'excused')) {
          absentCount = Math.max(0, absentCount - 1);
        }
        return { ...s, status, time, absentCount };
      }
      return s;
    });

    updateAndSortStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    saveData(newStudents, newHistory);
  };

  const deleteStudent = (id: string) => {
    const newStudents = students.filter(s => s.id !== id);
    updateAndSortStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    saveData(newStudents, newHistory);
    
    // Also delete from Firestore collection
    if (db) deleteDoc(doc(db, 'students', id)).catch(console.error);
  };

  const handleExcuseAction = (studentId: string, excuseId: string, action: 'approved' | 'rejected') => {
    const newStudents = students.map(s => {
      if (s.id === studentId) {
        const updatedExcuses = (s.excuses || []).map(e => e.id === excuseId ? { ...e, status: action } : e);
        return { ...s, excuses: updatedExcuses };
      }
      return s;
    });
    updateAndSortStudents(newStudents);
    saveData(newStudents, attendanceHistory);
    
    // Update the specific student in Firestore
    const student = newStudents.find(s => s.id === studentId);
    if (student) saveSingleStudent(student);
  };

  const handleAdminLogin = (password: string) => {
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setView('admin');
    } else {
      alert("كلمة المرور غير صحيحة");
    }
  };

  const handleStudentLogin = (phone: string) => {
    const student = students.find(s => s.phone === phone);
    if (student) {
      setLoggedInStudent(student);
      setView('student');
    } else {
      alert("رقم الجوال غير مسجل");
    }
  };

  const handleLogout = async () => {
    setIsAdmin(false);
    setLoggedInStudent(null);
    setStudentPhone('');
    setView('login');
  };

  const deleteHistoryRecord = (studentPhone: string, date: string) => {
    const newHistory = { ...attendanceHistory };
    if (newHistory[date]) {
      newHistory[date] = newHistory[date].filter(s => s.phone !== studentPhone);
      if (newHistory[date].length === 0) {
        delete newHistory[date];
      }
    }
    setAttendanceHistory(newHistory);
    saveData(students, newHistory);
  };

  const updateStudentExcuses = (studentId: string, excuses: Excuse[]) => {
    const newStudents = students.map(s => s.id === studentId ? { ...s, excuses } : s);
    updateAndSortStudents(newStudents);
    
    // Also update attendanceHistory for today to ensure AdminView sees the new excuse
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    
    saveData(newStudents, newHistory);
    
    // Update the specific student in Firestore
    const student = newStudents.find(s => s.id === studentId);
    if (student) saveSingleStudent(student);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loader-spinner"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b]">
      <AnimatePresence mode="wait">
        {view === 'login' && (
          <LoginView 
            onAdminLogin={handleAdminLogin} 
            onStudentLogin={handleStudentLogin}
          />
        )}
        {view === 'admin' && (
          <AdminDashboard 
            students={students} 
            attendanceHistory={attendanceHistory}
            onUpdateStatus={updateStatus}
            onMarkBulk={markBulk}
            onDeleteStudent={deleteStudent}
            onExcuseAction={handleExcuseAction}
            onImportStudents={async (newS: Student[]) => {
              if (!db) return;
              setImportStatus({ loading: true, message: 'جاري تحديث البيانات...' });
              
              try {
                const { writeBatch, doc, collection, getDocs } = await import('firebase/firestore');
                
                // De-duplicate by ID (which is now stable)
                const uniqueMap = new Map<string, Student>();
                newS.forEach(s => uniqueMap.set(s.id, s));
                const uniqueList = Array.from(uniqueMap.values()) as Student[];
                
                const sorted = [...uniqueList].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
                
                // Fetch current students from Firestore to identify what to delete
                const snapshot = await getDocs(collection(db, 'students'));
                const currentIds = snapshot.docs.map(d => d.id);
                const newIds = new Set(uniqueList.map(s => s.id));
                
                // Identify IDs that are in DB but NOT in the new list
                const toDelete = currentIds.filter(id => !newIds.has(id));
                
                console.log(`Importing ${sorted.length} students, deleting ${toDelete.length} students.`);
                
                // Firestore batch limit is 500 operations. We need to chunk them.
                const allOps: ({ type: 'delete', id: string } | { type: 'set', id: string, data: Student })[] = [
                  ...toDelete.map(id => ({ type: 'delete' as const, id })),
                  ...sorted.map(s => ({ type: 'set' as const, id: s.id, data: s }))
                ];
                
                const CHUNK_SIZE = 450; 
                for (let i = 0; i < allOps.length; i += CHUNK_SIZE) {
                  const chunk = allOps.slice(i, i + CHUNK_SIZE);
                  const batch = writeBatch(db);
                  
                  chunk.forEach(op => {
                    if (op.type === 'delete') {
                      batch.delete(doc(db, 'students', op.id));
                    } else if (op.type === 'set') {
                      batch.set(doc(db, 'students', op.id), op.data);
                    }
                  });
                  
                  await batch.commit();
                  setImportStatus({ loading: true, message: `جاري معالجة الدفعة ${Math.ceil((i + CHUNK_SIZE) / CHUNK_SIZE)}...` });
                }
                
                setImportStatus({ loading: false, message: 'تم تحديث البيانات بنجاح!' });
                setTimeout(() => setImportStatus(null), 3000);
              } catch (err) {
                console.error("Error during batch import:", err);
                const errorMsg = err instanceof Error ? err.message : String(err);
                setImportStatus({ 
                  loading: false, 
                  message: `حدث خطأ: ${errorMsg}. يرجى التأكد من اتصال الإنترنت والمحاولة مرة أخرى.` 
                });
                setTimeout(() => setImportStatus(null), 7000);
              }
            }}
            onLogout={handleLogout} 
          />
        )}
        {view === 'student' && loggedInStudent && (
          <StudentPortal 
            student={loggedInStudent} 
            students={students}
            history={attendanceHistory}
            onDeleteRecord={deleteHistoryRecord}
            onUpdateExcuses={updateStudentExcuses}
            onLogout={handleLogout} 
          />
        )}
        {importStatus && (
          <div className="modal-overlay active z-[100]">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="modal-box max-w-sm p-8 text-center"
            >
              {importStatus.loading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-sky-200 border-t-sky-600 rounded-full animate-spin"></div>
                  <p className="font-black text-slate-700">{importStatus.message}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className={`w-16 h-16 ${importStatus.message.includes('خطأ') ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'} rounded-full flex items-center justify-center`}>
                    {importStatus.message.includes('خطأ') ? <XCircle size={40} /> : <CheckCircle size={40} />}
                  </div>
                  <p className="font-black text-slate-700">{importStatus.message}</p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Login View ---
function LoginView({ onAdminLogin, onStudentLogin }: { 
  onAdminLogin: (p: string) => void, 
  onStudentLogin: (p: string) => void 
}) {
  const [mode, setMode] = useState<'student' | 'admin'>('student');
  const [input, setInput] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="login-container"
    >
      <div className="login-card">
        <div className="login-header">
          <h1>نظام إدارة الحضور</h1>
          <p>مدرسة الجشة المتوسطة</p>
        </div>

        <div className="login-tabs">
          <button 
            className={`login-tab ${mode === 'student' ? 'active' : ''}`}
            onClick={() => { setMode('student'); setInput(''); }}
          >
            بوابة الطالب
          </button>
          <button 
            className={`login-tab ${mode === 'admin' ? 'active' : ''}`}
            onClick={() => { setMode('admin'); setInput(''); }}
          >
            بوابة الإدارة
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="form-label">
              {mode === 'student' ? 'رقم الجوال' : 'كلمة المرور'}
            </label>
            <input 
              type={mode === 'student' ? 'tel' : 'password'}
              className="form-input"
              placeholder={mode === 'student' ? '05xxxxxxxx' : '••••••••'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (mode === 'student' ? onStudentLogin(input) : onAdminLogin(input))}
            />
          </div>
          <button 
            className="modal-btn"
            onClick={() => mode === 'student' ? onStudentLogin(input) : onAdminLogin(input)}
          >
            دخول
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Admin Dashboard ---
function AdminDashboard({ 
  students, 
  attendanceHistory, 
  onUpdateStatus, 
  onMarkBulk, 
  onDeleteStudent, 
  onExcuseAction, 
  onImportStudents, 
  onLogout 
}: { 
  students: Student[], 
  attendanceHistory: AttendanceHistory,
  onUpdateStatus: (id: string, status: Student['status']) => Student | null,
  onMarkBulk: (status: Student['status'], ids: string[]) => void,
  onDeleteStudent: (id: string) => void,
  onExcuseAction: (studentId: string, excuseId: string, action: 'approved' | 'rejected') => void,
  onImportStudents: (s: Student[]) => void,
  onLogout: () => void
}) {
  const [activeAdminTab, setActiveAdminTab] = useState<'attendance' | 'excuses'>('attendance');
  const [filter, setFilter] = useState({ search: '', classes: [] as string[], status: 'all' });
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [showReportsDropdown, setShowReportsDropdown] = useState(false);
  const [reportType, setReportType] = useState<'daily' | 'monthly' | 'student' | 'warning' | null>(null);
  const [selectedStudentForAi, setSelectedStudentForAi] = useState<Student | null>(null);
  const [selectedStudentForJourney, setSelectedStudentForJourney] = useState<Student | null>(null);
  const [statusChangeNotification, setStatusChangeNotification] = useState<{ student: Student, type: 'absent' | 'late' } | null>(null);
  const [aiMessage, setAiMessage] = useState('');
  const [aiMessageLoading, setAiMessageLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [previewExcuse, setPreviewExcuse] = useState<any>(null);
  const [importData, setImportData] = useState<Student[] | null>(null);

  const [excuseFilter, setExcuseFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  const allExcuses = students.flatMap(s => (s.excuses || []).map(e => ({ ...e, studentName: s.name, studentId: s.id, studentClass: s.class })));
  const filteredExcuses = allExcuses.filter(e => excuseFilter === 'all' || e.status === excuseFilter).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const pendingCount = allExcuses.filter(e => e.status === 'pending').length;

  const handleExcuseAction = (studentId: string, excuseId: string, action: 'approved' | 'rejected') => {
    onExcuseAction(studentId, excuseId, action);
  };

  const handlePrintExcuse = (excuse: any) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html dir="rtl">
          <head>
            <title>طباعة عذر الطالب</title>
            <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
            <style>
              body { font-family: 'Tajawal', sans-serif; padding: 40px; line-height: 1.6; direction: rtl; }
              .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
              .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
              .label { font-weight: bold; color: #666; }
              .content { background: #f9fafb; padding: 20px; border-radius: 10px; border: 1px solid #eee; }
              .footer { margin-top: 50px; text-align: left; font-size: 0.9em; color: #888; }
              @media print {
                @page { margin: 1cm; }
                body { padding: 0; }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="color: #4f46e5; margin-bottom: 5px;">إشعار عذر ومبرر غياب/تأخر</h1>
              <p style="font-weight: bold; color: #64748b;">مدرسة الجشة المتوسطة</p>
            </div>
            <div class="info-grid">
              <div><span class="label">اسم الطالب:</span> ${excuse.studentName}</div>
              <div><span class="label">الفصل:</span> ${excuse.studentClass}</div>
              <div><span class="label">تاريخ العذر:</span> ${excuse.date}</div>
              <div><span class="label">نوع العذر:</span> ${excuse.type}</div>
            </div>
            <div class="label" style="margin-bottom: 10px;">تفاصيل المبرر:</div>
            <div class="content">${excuse.detail}</div>
            
            ${excuse.fileData && !excuse.fileName?.toLowerCase().endsWith('.pdf') ? `
              <div style="margin-top: 30px;">
                <div class="label" style="margin-bottom: 10px;">المرفق (صورة):</div>
                <img src="${excuse.fileData}" style="max-width: 100%; border: 1px solid #eee; border-radius: 10px;" />
              </div>
            ` : ''}

            ${excuse.fileData && excuse.fileName?.toLowerCase().endsWith('.pdf') ? `
              <div style="margin-top: 30px; padding: 20px; border: 2px dashed #ccc; text-align: center; color: #666;">
                <p>مرفق ملف PDF: ${excuse.fileName}</p>
                <p style="font-size: 0.8em;">(يرجى طباعة ملف PDF المرفق بشكل منفصل من نافذة المعاينة)</p>
              </div>
            ` : ''}

            <div class="footer">
              <p>صدر هذا التقرير آلياً من نظام المواظبة المدرسية</p>
              <p>التاريخ: ${new Date().toLocaleDateString('ar-SA')}</p>
            </div>
            <script>
              window.onload = function() {
                setTimeout(() => {
                  window.print();
                  setTimeout(() => {
                    window.frameElement.remove();
                  }, 100);
                }, 500);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
    }
  };

  const filteredStudents = students.filter(s => {
    const matchSearch = s.name.includes(filter.search) || s.phone.includes(filter.search);
    const matchClass = filter.classes.length === 0 || filter.classes.includes(s.class);
    const matchStatus = filter.status === 'all' || s.status === filter.status;
    return matchSearch && matchClass && matchStatus;
  });

  const classes = Array.from(new Set(students.map(s => s.class))).sort();

  const toggleClassFilter = (cls: string) => {
    setFilter(prev => ({
      ...prev,
      classes: prev.classes.includes(cls) 
        ? prev.classes.filter(c => c !== cls) 
        : [...prev.classes, cls]
    }));
  };

  const generateParentMessage = async (student: Student) => {
    setSelectedStudentForAi(student);
    setAiMessageLoading(true);
    setAiMessage('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const prompt = `اكتب رسالة واتساب قصيرة ومهذبة لولي أمر الطالب ${student.name} تخبره فيها أن الطالب ${student.status === 'absent' ? 'غائب' : 'متأخر'} اليوم. اطلب منه التعاون للحرص على انضباط الطالب.`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiMessage(response.text || "لا يمكن صياغة الرسالة حالياً.");
    } catch (error) {
      console.error(error);
      setAiMessage("حدث خطأ أثناء صياغة الرسالة.");
    }
    setAiMessageLoading(false);
  };

  const updateStatus = (id: string, status: Student['status']) => {
    const updatedStudent = onUpdateStatus(id, status);
    if (updatedStudent && (status === 'absent' || status === 'late')) {
      setStatusChangeNotification({ student: updatedStudent, type: status });
    }
  };

  const markBulk = (status: Student['status']) => {
    const ids = filteredStudents.map(s => s.id);
    onMarkBulk(status, ids);
  };

  const deleteStudent = (id: string) => {
    onDeleteStudent(id);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

        const newStudents: Student[] = data.slice(1).map((row: any) => {
          const name = String(row[0] || '').trim();
          const phone = String(row[2] || '').trim();
          // Create a stable ID based on name and phone to prevent duplicates
          const id = btoa(encodeURIComponent(name + phone)).replace(/[/+=]/g, '').substr(0, 15);
          
          return {
            id,
            name,
            class: String(row[1] || 'عام').trim(),
            phone,
            status: 'none' as 'none',
            time: '-',
            absentCount: 0
          };
        }).filter((s: any) => s.name);

        if (newStudents.length > 0) {
          setImportData(newStudents);
        }
      } catch (error) {
        console.error("Error importing Excel:", error);
      }
    };
    reader.readAsBinaryString(file);
    // Reset input
    e.target.value = '';
  };

  const generateAiAnalysis = async () => {
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const stats = {
        total: students.length,
        present: students.filter(s => s.status === 'present').length,
        absent: students.filter(s => s.status === 'absent').length,
        late: students.filter(s => s.status === 'late').length
      };

      const prompt = `حلل بيانات الحضور هذه لمدرسة: إجمالي الطلاب ${stats.total}، حاضر ${stats.present}، غائب ${stats.absent}، متأخر ${stats.late}. قدم توصيات للموجه الطلابي لتحسين الانضباط.`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiAnalysis(response.text || "لا يمكن التحليل حالياً.");
    } catch (error) {
      console.error(error);
      setAiAnalysis("حدث خطأ أثناء التحليل الذكي.");
    }
    setAiLoading(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="container"
    >
      <header className="admin-header">
        <div className="header-right">
          <Users size={28} />
          <h1>نظام إدارة الحضور والغياب (الموجه الطلابي)</h1>
        </div>

        <div className="admin-tabs">
          <button 
            onClick={() => setActiveAdminTab('attendance')}
            className={`admin-tab-btn ${activeAdminTab === 'attendance' ? 'active' : 'inactive'}`}
          >
            إدارة التحضير
          </button>
          <button 
            onClick={() => setActiveAdminTab('excuses')}
            className={`admin-tab-btn ${activeAdminTab === 'excuses' ? 'active' : 'inactive'} flex items-center gap-2`}
          >
            الأعذار والمبررات
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>
        </div>

        <div className="header-left">
          <div className="date-box">
            {new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="user-info">
            <span className="name">عبدالهادي المحسن</span>
            <span className="school">مدرسة الجشة المتوسطة</span>
          </div>
          <button onClick={onLogout} className="logout-btn-custom">
            <LogOut size={16} />
            خروج
          </button>
        </div>
      </header>

      {activeAdminTab === 'attendance' ? (
        <>
          {/* Stats */}
          <div className="stats-grid">
            <StatCard title="إجمالي الطلاب" value={students.length} icon={<Users />} color="primary" />
            <StatCard title="حاضر اليوم" value={students.filter(s => s.status === 'present').length} icon={<CheckCircle />} color="success" />
            <StatCard title="غائب اليوم" value={students.filter(s => s.status === 'absent').length} icon={<XCircle />} color="danger" />
            <StatCard title="غائب بعذر" value={students.filter(s => s.status === 'excused').length} icon={<FileText />} color="info" />
            <StatCard title="متأخر اليوم" value={students.filter(s => s.status === 'late').length} icon={<Clock />} color="warning" />
          </div>

          {/* Controls */}
          <div className="controls-section">
            <div className="filters-row">
              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="ابحث باسم الطالب أو الجوال..." 
                  value={filter.search}
                  onChange={(e) => setFilter(prev => ({ ...prev, search: e.target.value }))}
                />
              </div>
              <div className="input-group relative group">
                <div className="flex flex-wrap gap-1 p-2 border border-slate-200 rounded-lg bg-slate-50 min-h-[42px]">
                  {filter.classes.length === 0 ? (
                    <span className="text-slate-400 text-sm">تصفية حسب الفصول...</span>
                  ) : (
                    filter.classes.map(c => (
                      <span key={c} className="bg-primary text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                        {c}
                        <button onClick={() => toggleClassFilter(c)} className="hover:text-red-200">×</button>
                      </span>
                    ))
                  )}
                </div>
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg mt-1 shadow-lg hidden group-hover:block max-h-48 overflow-y-auto">
                  {classes.map(c => (
                    <div 
                      key={c} 
                      className={`p-2 hover:bg-slate-50 cursor-pointer text-sm flex items-center justify-between ${filter.classes.includes(c) ? 'bg-blue-50 text-primary font-bold' : ''}`}
                      style={{
                        color: c.includes('أول') ? '#000000' : c.includes('ثاني') ? '#0077be' : c.includes('ثالث') ? '#4b0082' : 'inherit',
                        fontWeight: 'bold',
                        borderBottom: '1px solid #f1f5f9'
                      }}
                      onClick={() => toggleClassFilter(c)}
                    >
                      {c}
                      {filter.classes.includes(c) && <CheckCircle size={14} />}
                    </div>
                  ))}
                </div>
              </div>
              <div className="input-group">
                <select 
                  value={filter.status}
                  onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">جميع الحالات</option>
                  <option value="present">حاضر</option>
                  <option value="absent">غائب</option>
                  <option value="late">متأخر</option>
                  <option value="excused">بعذر</option>
                  <option value="none">لم يسجل</option>
                </select>
              </div>
            </div>
            <div className="actions-row justify-center">
              <div className="flex gap-2">
                <button className="btn btn-success" onClick={() => markBulk('present')}>الكل حاضر</button>
                <button className="btn btn-danger" onClick={() => markBulk('absent')}>الكل غائب</button>
              </div>
              <div className="flex gap-2">
                <div className="dropdown-container">
                  <button 
                    className="dropdown-trigger" 
                    onClick={() => setShowReportsDropdown(!showReportsDropdown)}
                  >
                    <BarChart3 size={18} />
                    التقارير والأدوات
                    <ChevronRight size={16} className={`transition-transform ${showReportsDropdown ? 'rotate-90' : ''}`} />
                  </button>
                  
                  <AnimatePresence>
                    {showReportsDropdown && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="dropdown-menu-custom"
                      >
                        <div className="dropdown-item-custom" onClick={() => { setReportType('daily'); setShowReportsDropdown(false); }}>
                          <div className="item-icon bg-orange-100 text-orange-600">
                            <FileText size={18} />
                          </div>
                          <span className="item-text">تقرير اليوم</span>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('monthly'); setShowReportsDropdown(false); }}>
                          <div className="item-icon bg-blue-100 text-blue-600">
                            <Calendar size={18} />
                          </div>
                          <span className="item-text">نطاق التاريخ</span>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('student'); setShowReportsDropdown(false); }}>
                          <div className="item-icon bg-slate-100 text-slate-600">
                            <Users size={18} />
                          </div>
                          <span className="item-text">تقرير بالطالب</span>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('warning'); setShowReportsDropdown(false); }}>
                          <div className="item-icon bg-red-100 text-red-600">
                            <AlertCircle size={18} />
                          </div>
                          <span className="item-text">تقرير الطلاب المنذرين</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                <button className="btn btn-outline border-red-200 text-red-600 hover:bg-red-50" onClick={() => setShowAbsenceModal(true)}>
                  <UserX size={18} />
                  الغيابات والتأخير
                </button>
                <label className="btn btn-outline cursor-pointer relative group">
                  <Upload size={18} />
                  استيراد إكسل
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImport} />
                  <div className="absolute -bottom-8 right-0 hidden group-hover:block bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                    الترتيب: الاسم، الفصل، الجوال
                  </div>
                </label>
                <button 
                  className="btn btn-ghost text-sky-600 text-xs font-bold"
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([["اسم الطالب", "الفصل", "رقم الجوال"], ["أحمد محمد", "أول متوسط-أ", "966500000000"]]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Students");
                    XLSX.writeFile(wb, "نموذج_استيراد_الطلاب.xlsx");
                  }}
                >
                  <Download size={14} />
                  تحميل النموذج
                </button>
              </div>
            </div>
          </div>

          {/* AI Analysis */}
          {aiAnalysis && (
            <div className="ai-box block mb-6">
              <div className="flex items-center gap-2 mb-2 text-purple-600 font-bold">
                <Sparkles size={18} />
                تحليل Gemini الذكي
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {aiAnalysis}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>اسم الطالب</th>
                  <th>رقم الجوال</th>
                  <th>الصف</th>
                  <th className="text-center">التحضير</th>
                  <th className="text-center">مسار الرحلة</th>
                  <th className="text-center">الوقت</th>
                  <th className="text-center">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(student => (
                  <tr key={student.id}>
                    <td>
                      <div className="student-name">
                        {student.name}
                        {student.absentCount > 3 && (
                          <span className="badge-warning">⚠️ غياب متكرر ({student.absentCount})</span>
                        )}
                      </div>
                    </td>
                    <td className="student-id" dir="ltr" style={{ fontSize: '14px', fontWeight: 'bold' }}>{student.phone}</td>
                    <td>{student.class}</td>
                    <td>
                      <div className="status-toggles">
                        <button 
                          className={`toggle-btn ${student.status === 'present' ? 'active-present' : ''}`}
                          onClick={() => updateStatus(student.id, 'present')}
                        >حاضر</button>
                        <button 
                          className={`toggle-btn ${student.status === 'absent' ? 'active-absent' : ''}`}
                          onClick={() => updateStatus(student.id, 'absent')}
                        >غائب</button>
                        <button 
                          className={`toggle-btn ${student.status === 'late' ? 'active-late' : ''}`}
                          onClick={() => updateStatus(student.id, 'late')}
                        >تأخير</button>
                        <button 
                          className={`toggle-btn ${student.status === 'excused' ? 'active-excused' : ''}`}
                          onClick={() => updateStatus(student.id, 'excused')}
                        >بعذر</button>
                      </div>
                    </td>
                    <td className="text-center">
                      <button 
                        className="journey-btn"
                        onClick={() => setSelectedStudentForJourney(student)}
                      >
                        عرض المسار
                        <Zap size={14} />
                      </button>
                    </td>
                    <td className="text-center time-cell">{student.time}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {(student.status === 'absent' || student.status === 'late') && (
                          <button 
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded"
                            onClick={() => generateParentMessage(student)}
                            title="رسالة ذكية لولي الأمر"
                          >
                            <MessageSquare size={18} />
                          </button>
                        )}
                        <button className="delete-btn" onClick={() => onDeleteStudent(student.id)}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <h2 className="text-2xl font-black mb-2">طلبات الأعذار والمبررات</h2>
              <p className="text-slate-500">مراجعة واعتماد الأعذار المقدمة من الطلاب وأرشفتها</p>
            </div>
            <div className="flex flex-wrap gap-2 bg-slate-100 p-1.5 rounded-xl">
              <button 
                onClick={() => setExcuseFilter('pending')}
                className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all ${excuseFilter === 'pending' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                قيد الانتظار ({pendingCount})
              </button>
              <button 
                onClick={() => setExcuseFilter('approved')}
                className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all ${excuseFilter === 'approved' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                المقبولة
              </button>
              <button 
                onClick={() => setExcuseFilter('rejected')}
                className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all ${excuseFilter === 'rejected' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                المرفوضة
              </button>
              <button 
                onClick={() => setExcuseFilter('all')}
                className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all ${excuseFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                الكل
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredExcuses.map(excuse => (
              <div key={excuse.id} className="bg-white rounded-lg p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
                {excuse.status !== 'pending' && (
                  <div className={`absolute top-0 right-0 left-0 h-1.5 ${excuse.status === 'approved' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                )}
                
                <div className="flex justify-between items-start mb-5">
                  <div className={`px-3 py-1 rounded-lg text-[10px] font-black ${
                    excuse.status === 'approved' ? 'bg-emerald-100 text-emerald-600' : 
                    excuse.status === 'rejected' ? 'bg-red-100 text-red-600' : 
                    'bg-indigo-100 text-indigo-600'
                  }`}>
                    {excuse.type}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] text-slate-400 font-bold">{excuse.date}</div>
                    {excuse.status !== 'pending' && (
                      <div className={`w-2 h-2 rounded-full ${excuse.status === 'approved' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    )}
                  </div>
                </div>

                <div className="mb-5">
                  <div className="font-black text-slate-800 text-lg">{excuse.studentName}</div>
                  <div className="text-xs text-slate-400 font-bold mt-0.5">{excuse.studentClass}</div>
                </div>

                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 mb-6 min-h-[80px]">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {excuse.detail}
                  </p>
                </div>

                {/* Attachment Actions */}
                <div className="flex items-center justify-between mb-6 p-3 bg-indigo-50/50 rounded-lg border border-indigo-100/50">
                  <span className="text-xs font-black text-indigo-600 flex items-center gap-2">
                    <FileText size={14} />
                    المرفقات
                  </span>
                  <div className="flex gap-1">
                    <button 
                      className="p-2 text-indigo-600 hover:bg-white rounded-lg transition-all" 
                      title="استعراض المرفقات"
                      onClick={() => setPreviewExcuse(excuse)}
                    >
                      <Eye size={16} />
                    </button>
                    <button 
                      className="p-2 text-indigo-600 hover:bg-white rounded-lg transition-all" 
                      title="تحميل"
                      onClick={() => {
                        if (excuse.fileData) {
                          const link = document.createElement('a');
                          link.href = excuse.fileData;
                          link.download = excuse.fileName || 'attachment';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        } else {
                          const content = `مرفق عذر الطالب: ${excuse.studentName}\nالتاريخ: ${excuse.date}\nالنوع: ${excuse.type}\nالتفاصيل: ${excuse.detail}`;
                          const blob = new Blob([content], { type: 'text/plain' });
                          const url = window.URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = excuse.fileName || 'عذر_طبي.txt';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          window.URL.revokeObjectURL(url);
                        }
                      }}
                    >
                      <Download size={16} />
                    </button>
                    <button 
                      className="p-2 text-indigo-600 hover:bg-white rounded-lg transition-all" 
                      title="طباعة"
                      onClick={() => handlePrintExcuse(excuse)}
                    >
                      <Printer size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => handleExcuseAction(excuse.studentId, excuse.id, 'approved')}
                    className={`flex-1 py-3 rounded-lg font-black text-sm transition-all flex items-center justify-center gap-2 ${
                      excuse.status === 'approved' 
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100' 
                      : 'bg-white text-emerald-600 border-2 border-emerald-50 hover:bg-emerald-50'
                    }`}
                  >
                    <Check size={18} />
                    {excuse.status === 'approved' ? 'تم القبول' : 'قبول'}
                  </button>
                  <button 
                    onClick={() => handleExcuseAction(excuse.studentId, excuse.id, 'rejected')}
                    className={`flex-1 py-3 rounded-lg font-black text-sm transition-all flex items-center justify-center gap-2 ${
                      excuse.status === 'rejected' 
                      ? 'bg-red-500 text-white shadow-lg shadow-red-100' 
                      : 'bg-white text-red-600 border-2 border-red-50 hover:bg-red-50'
                    }`}
                  >
                    <X size={18} />
                    {excuse.status === 'rejected' ? 'تم الرفض' : 'رفض'}
                  </button>
                </div>
              </div>
            ))}
            {filteredExcuses.length === 0 && (
              <div className="col-span-full text-center py-24 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                <ShieldCheck size={64} className="mx-auto text-slate-200 mb-6" />
                <p className="text-slate-400 font-black text-lg">لا توجد طلبات في هذا القسم حالياً.</p>
                <button 
                  onClick={() => setExcuseFilter('all')}
                  className="mt-4 text-indigo-600 font-bold hover:underline"
                >
                  عرض جميع الطلبات المؤرشفة
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAbsenceModal && (
          <div className="modal-overlay active" onClick={() => setShowAbsenceModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="modal-box max-w-5xl p-0 overflow-hidden rounded-none border-none shadow-2xl" 
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-sky-500 via-cyan-600 to-teal-600 p-10 text-white relative">
                <button className="absolute top-8 left-8 text-white/80 hover:text-white transition-colors" onClick={() => setShowAbsenceModal(false)}>
                  <XCircle size={32} />
                </button>
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-inner">
                    <Users size={40} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-3xl font-black">قائمة الغياب والتأخير اليوم</h3>
                    <p className="text-white/80 text-base font-bold mt-2 flex items-center gap-2">
                      <Calendar size={18} />
                      سجل المتابعة اليومي - {new Date().toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-10 space-y-10 bg-sky-50/30">
                <div className="grid grid-cols-2 gap-8">
                  <div className="bg-white p-8 rounded-2xl border border-sky-100 shadow-sm flex flex-col items-center justify-center text-center group hover:border-sky-300 transition-colors">
                    <div className="text-5xl font-black text-red-500 mb-3 group-hover:scale-110 transition-transform">
                      {students.filter(s => s.status === 'absent').length}
                    </div>
                    <div className="text-sm text-slate-400 font-black uppercase tracking-widest">إجمالي الغياب</div>
                  </div>
                  <div className="bg-white p-8 rounded-2xl border border-sky-100 shadow-sm flex flex-col items-center justify-center text-center group hover:border-sky-300 transition-colors">
                    <div className="text-5xl font-black text-amber-500 mb-3 group-hover:scale-110 transition-transform">
                      {students.filter(s => s.status === 'late').length}
                    </div>
                    <div className="text-sm text-slate-400 font-black uppercase tracking-widest">إجمالي التأخير</div>
                  </div>
                </div>

                <div className="max-h-[500px] overflow-y-auto space-y-5 pr-4 custom-scrollbar">
                  {students.filter(s => s.status === 'absent' || s.status === 'late').map(s => (
                    <div key={s.id} className="flex items-center justify-between p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-sky-200 transition-all group">
                      <div className="flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 ${s.status === 'absent' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
                          {s.status === 'absent' ? <XCircle size={28} /> : <Clock size={28} />}
                        </div>
                        <div>
                          <div className="font-black text-slate-800 text-lg">{s.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs bg-sky-50 text-sky-700 px-3 py-1 rounded-lg font-bold border border-sky-100">{s.class}</span>
                            <span className="text-sm text-slate-400 font-mono font-bold" dir="ltr">{s.phone}</span>
                          </div>
                        </div>
                      </div>
                      <div className={`px-5 py-2.5 rounded-xl text-xs font-black shadow-sm ${s.status === 'absent' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
                        {s.status === 'absent' ? 'غائب' : 'متأخر'}
                      </div>
                    </div>
                  ))}
                  {students.filter(s => s.status === 'absent' || s.status === 'late').length === 0 && (
                    <div className="text-center py-24 bg-white rounded-xl border-2 border-dashed border-sky-100">
                      <ShieldCheck size={64} className="mx-auto text-sky-200 mb-6" />
                      <p className="text-slate-400 font-black text-lg">لا يوجد غيابات أو تأخيرات مسجلة لليوم.</p>
                    </div>
                  )}
                </div>

                <button 
                  className="w-full bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white flex items-center justify-center gap-3 py-5 rounded-xl font-black text-xl shadow-xl shadow-sky-100 transition-all active:scale-[0.98]"
                  onClick={async () => {
                    const absent = students.filter(s => s.status === 'absent');
                    const late = students.filter(s => s.status === 'late');
                    const data = [
                      ...absent.map(s => ({ name: s.name, class: s.class, status: 'غائب' })),
                      ...late.map(s => ({ name: s.name, class: s.class, status: 'متأخر' }))
                    ];

                    const docGen = new Document({
                      sections: [{
                        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            bidirectional: true,
                            children: [new TextRun({ text: "المملكة العربية السعودية", bold: true, size: 24, font: "Tajawal" })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            bidirectional: true,
                            children: [new TextRun({ text: "وزارة التعليم", bold: true, size: 24, font: "Tajawal" })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            bidirectional: true,
                            children: [new TextRun({ text: "الإدارة العامة للتعليم بمحافظة الأحساء", bold: true, size: 24, font: "Tajawal" })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            bidirectional: true,
                            children: [new TextRun({ text: "مدرسة الجشة المتوسطة", bold: true, size: 24, font: "Tajawal" })],
                          }),
                          new Paragraph({ text: "" }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            children: [new TextRun({ text: "تقرير الغياب والتأخير اليومي", bold: true, size: 36, font: "Tajawal", color: "0ea5e9" })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            children: [new TextRun({ text: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}`, size: 24, font: "Tajawal", color: "64748b" })],
                          }),
                          new Paragraph({ text: "" }),
                          new Table({
                            width: { size: 100, type: WidthType.PERCENTAGE },
                            rows: [
                              new TableRow({
                                children: [
                                  new TableCell({ 
                                    shading: { fill: "0ea5e9" },
                                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "اسم الطالب", bold: true, font: "Tajawal", size: 28, color: "ffffff" })] })] 
                                  }),
                                  new TableCell({ 
                                    shading: { fill: "0ea5e9" },
                                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "الفصل", bold: true, font: "Tajawal", size: 28, color: "ffffff" })] })] 
                                  }),
                                  new TableCell({ 
                                    shading: { fill: "0ea5e9" },
                                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "الحالة", bold: true, font: "Tajawal", size: 28, color: "ffffff" })] })] 
                                  }),
                                ],
                              }),
                              ...data.map(item => new TableRow({
                                children: [
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: item.name, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: item.class, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: item.status, font: "Tajawal", size: 28, color: item.status === 'غائب' ? 'FF0000' : 'F59E0B' })] })] }),
                                ],
                              })),
                            ],
                          }),
                        ],
                      }],
                    });
                    const blob = await Packer.toBlob(docGen);
                    saveAs(blob, `تقرير_الغياب_اليومي_${new Date().toISOString().split('T')[0]}.docx`);
                  }}
                >
                  <FileDown size={28} />
                  تصدير القائمة (Word)
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedStudentForAi && (
          <div className="modal-overlay active" onClick={() => setSelectedStudentForAi(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3>رسالة ذكية لولي الأمر</h3>
                <button className="close-btn" onClick={() => setSelectedStudentForAi(null)}>×</button>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                  <div className="font-bold text-purple-700">{selectedStudentForAi.name}</div>
                  <div className="text-xs text-purple-500">الحالة: {selectedStudentForAi.status === 'absent' ? 'غائب' : 'متأخر'}</div>
                </div>
                
                {aiMessageLoading ? (
                  <div className="py-10 text-center">
                    <div className="loader-spinner mb-2"></div>
                    <div className="text-purple-600 font-bold">جاري صياغة الرسالة...</div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm leading-relaxed whitespace-pre-wrap relative">
                    {aiMessage}
                    <button 
                      className="absolute top-2 left-2 p-1 text-slate-400 hover:text-primary"
                      onClick={() => {
                        navigator.clipboard.writeText(aiMessage);
                        alert("تم نسخ الرسالة");
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  <button 
                    className="modal-btn flex-1 bg-green-600 hover:bg-green-700 flex items-center justify-center gap-2"
                    onClick={() => {
                      const url = `https://wa.me/${selectedStudentForAi.phone}?text=${encodeURIComponent(aiMessage)}`;
                      window.open(url, '_blank');
                    }}
                  >
                    <Share2 size={18} />
                    إرسال واتساب
                  </button>
                  <button className="modal-btn flex-1 bg-slate-200 text-slate-700 hover:bg-slate-300" onClick={() => setSelectedStudentForAi(null)}>إغلاق</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Student Journey Modal */}
        {selectedStudentForJourney && (
          <div className="modal-overlay active" onClick={() => setSelectedStudentForJourney(null)}>
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="modal-box max-w-6xl p-0 overflow-hidden bg-transparent shadow-none"
              onClick={e => e.stopPropagation()}
            >
              <JourneyVisualization 
                student={selectedStudentForJourney} 
                history={attendanceHistory}
                onClose={() => setSelectedStudentForJourney(null)} 
              />
            </motion.div>
          </div>
        )}

        {/* Reports Modals */}
        {reportType && (
          <div className="modal-overlay active" onClick={() => setReportType(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-md" 
              onClick={e => e.stopPropagation()}
            >
              <ReportsModal 
                type={reportType}
                students={students} 
                history={attendanceHistory}
                onClose={() => setReportType(null)} 
              />
            </motion.div>
          </div>
        )}

        {/* Status Change Notification Modal */}
        {statusChangeNotification && (
          <div className="modal-overlay active z-[100]" onClick={() => setStatusChangeNotification(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="modal-box max-w-md p-0 overflow-hidden rounded-2xl border-none shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className={`p-6 text-white flex items-center gap-4 ${
                statusChangeNotification.type === 'absent' ? 'bg-red-500' : 'bg-amber-500'
              }`}>
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <BellRing size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black">تحديث حالة الطالب</h3>
                  <p className="text-white/80 text-xs font-bold">تم تسجيل {statusChangeNotification.type === 'absent' ? 'غياب' : 'تأخر'}</p>
                </div>
              </div>
              
              <div className="p-8 text-center">
                <div className="mb-6">
                  <div className="text-slate-400 text-xs font-bold mb-1">اسم الطالب</div>
                  <div className="text-xl font-black text-slate-800">{statusChangeNotification.student.name}</div>
                </div>
                
                <div className="flex items-center justify-center gap-3 mb-8">
                  <div className="text-slate-400 text-xs font-bold">الحالة الجديدة:</div>
                  <div className={`px-4 py-1.5 rounded-xl font-black text-sm ${
                    statusChangeNotification.type === 'absent' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {statusChangeNotification.type === 'absent' ? 'غائب' : 'متأخر'}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white py-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-100"
                    onClick={() => {
                      const msg = `السلام عليكم، نود إحاطتكم علماً بأن الطالب ${statusChangeNotification.student.name} قد تم تسجيله ك${statusChangeNotification.type === 'absent' ? 'غائب' : 'متأخر'} اليوم. نرجو منكم المتابعة والحرص على انضباط الطالب.`;
                      const url = `https://wa.me/${statusChangeNotification.student.phone}?text=${encodeURIComponent(msg)}`;
                      window.open(url, '_blank');
                      setStatusChangeNotification(null);
                    }}
                  >
                    <MessageSquare size={18} />
                    إرسال واتساب
                  </button>
                  <button 
                    className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-xl font-black transition-all"
                    onClick={() => setStatusChangeNotification(null)}
                  >
                    تجاهل
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {previewExcuse && (
          <div className="modal-overlay active" onClick={() => setPreviewExcuse(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-4xl p-0 overflow-hidden rounded-xl border-none shadow-2xl bg-slate-900"
              onClick={e => e.stopPropagation()}
            >
              {/* Toolbar */}
              <div className="bg-slate-800 p-4 flex justify-between items-center text-white border-b border-slate-700">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-indigo-500/20 rounded-lg">
                    {previewExcuse.fileName?.toLowerCase().endsWith('.pdf') ? (
                      <FileText className="text-indigo-400" size={20} />
                    ) : (
                      <ImageIcon className="text-indigo-400" size={20} />
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-black text-sm">{previewExcuse.fileName || 'مرفق_عذر.pdf'}</div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-2">
                      <span>{previewExcuse.type}</span>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span>{previewExcuse.date}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-300"
                    onClick={() => {
                      if (previewExcuse.fileData) {
                        const link = document.createElement('a');
                        link.href = previewExcuse.fileData;
                        link.download = previewExcuse.fileName || 'attachment';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        const content = `مرفق عذر الطالب: ${previewExcuse.studentName}\nالتاريخ: ${previewExcuse.date}\nالنوع: ${previewExcuse.type}\nالتفاصيل: ${previewExcuse.detail}`;
                        const blob = new Blob([content], { type: 'text/plain' });
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = previewExcuse.fileName || 'عذر_طبي.txt';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(url);
                      }
                    }}
                    title="تحميل"
                  >
                    <Download size={20} />
                  </button>
                  <button onClick={() => setPreviewExcuse(null)} className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors text-slate-300">
                    <X size={24} />
                  </button>
                </div>
              </div>

              {/* Content Area */}
              <div className="p-6 bg-slate-900 flex items-center justify-center min-h-[600px] relative overflow-auto custom-scrollbar">
                {previewExcuse.fileData ? (
                  /* Real File Viewer */
                  <div className="w-full h-full flex items-center justify-center">
                    {previewExcuse.fileName?.toLowerCase().endsWith('.pdf') ? (
                      <iframe 
                        src={previewExcuse.fileData} 
                        className="w-full h-[700px] rounded-lg border-none bg-white"
                        title="PDF Preview"
                      />
                    ) : (
                      <div className="relative group max-w-3xl w-full">
                        <img 
                          src={previewExcuse.fileData}
                          alt="مرفق عذر"
                          className="rounded-lg shadow-2xl w-full object-contain max-h-[80vh] border-4 border-slate-800"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6 rounded-lg text-right">
                          <div className="text-white w-full">
                            <div className="font-black text-sm">{previewExcuse.fileName}</div>
                            <div className="text-xs text-white/70">تم الرفع بواسطة: {previewExcuse.studentName}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Fallback Simulation */
                  previewExcuse.fileName?.toLowerCase().endsWith('.pdf') ? (
                    /* Simulated PDF Viewer */
                    <div className="bg-white w-full max-w-2xl aspect-[1/1.414] shadow-2xl p-12 text-right relative">
                      <div className="absolute top-0 left-0 right-0 h-2 bg-indigo-600"></div>
                      <div className="flex justify-between items-start mb-12">
                        <div className="w-20 h-20 bg-slate-100 rounded-lg border-2 border-slate-200 flex items-center justify-center">
                          <span className="text-[10px] font-black text-slate-400">ختم المدرسة</span>
                        </div>
                        <div className="text-right">
                          <h1 className="text-2xl font-black text-slate-900 mb-2">تقرير طبي معتمد (معاينة)</h1>
                          <p className="text-sm text-slate-500">وزارة الصحة - مجمع العيادات</p>
                        </div>
                      </div>

                      <div className="space-y-8">
                        <div className="border-b-2 border-slate-100 pb-4">
                          <div className="text-xs text-slate-400 mb-2">بيانات المريض:</div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-xs text-slate-500">الاسم:</span>
                              <span className="text-sm font-black mr-2">{previewExcuse.studentName}</span>
                            </div>
                            <div>
                              <span className="text-xs text-slate-500">التاريخ:</span>
                              <span className="text-sm font-black mr-2">{previewExcuse.date}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4 text-right">
                          <div className="text-xs text-slate-400">التفاصيل الطبية:</div>
                          <p className="text-sm text-slate-700 leading-loose bg-slate-50 p-6 rounded-xl border border-slate-100 italic">
                            "{previewExcuse.detail}"
                          </p>
                        </div>

                        <div className="pt-12 flex justify-between items-end">
                          <div className="text-center">
                            <div className="w-32 h-1 bg-slate-200 mb-2"></div>
                            <div className="text-[10px] text-slate-400">توقيع الطبيب</div>
                          </div>
                          <div className="text-center">
                            <div className="w-32 h-1 bg-slate-200 mb-2"></div>
                            <div className="text-[10px] text-slate-400">ختم المنشأة</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="absolute bottom-8 left-0 right-0 text-center text-[8px] text-slate-300">
                        هذا المستند تم إنشاؤه آلياً لأغراض المعاينة (لم يتم رفع ملف حقيقي)
                      </div>
                    </div>
                  ) : (
                    /* Simulated Image Viewer */
                    <div className="relative group max-w-3xl w-full">
                      <img 
                        src={`https://picsum.photos/seed/${previewExcuse.id}/1200/1600`}
                        alt="مرفق عذر"
                        className="rounded-lg shadow-2xl w-full object-contain max-h-[70vh] border-4 border-slate-800"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6 rounded-lg text-right">
                        <div className="text-white w-full">
                          <div className="font-black text-sm">{previewExcuse.fileName}</div>
                          <div className="text-xs text-white/70">تم الرفع بواسطة: {previewExcuse.studentName}</div>
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}

        {importData && (
          <div className="modal-overlay active" onClick={() => setImportData(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-lg p-8 text-center rounded-none"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-sky-100 text-sky-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <FileSpreadsheet size={40} />
              </div>
              <h3 className="text-2xl font-black mb-4">تأكيد استيراد البيانات</h3>
              <p className="text-slate-500 mb-6 leading-relaxed">
                تم العثور على <span className="font-black text-sky-600">{importData.length}</span> طالب في الملف.
              </p>
              
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-8 max-h-40 overflow-y-auto text-right">
                <div className="text-[10px] text-slate-400 mb-2 font-bold">معاينة أول 3 طلاب:</div>
                {importData.slice(0, 3).map((s) => (
                  <div key={s.id} className="text-xs font-bold text-slate-700 py-1 border-b border-slate-200 last:border-0">
                    {s.name} - {s.class}
                  </div>
                ))}
                {importData.length > 3 && <div className="text-[10px] text-slate-400 mt-2">...و {importData.length - 3} طلاب آخرين</div>}
              </div>

              <div className="space-y-3">
                <button 
                  className="w-full bg-sky-600 text-white py-4 rounded-xl font-black hover:bg-sky-700 transition-all shadow-lg shadow-sky-100"
                  onClick={() => {
                    onImportStudents(importData);
                    setImportData(null);
                  }}
                >
                  استبدال القائمة الحالية
                </button>
                <button 
                  className="w-full bg-white text-slate-700 border-2 border-slate-100 py-4 rounded-xl font-black hover:bg-slate-50 transition-all"
                  onClick={() => {
                    onImportStudents([...students, ...importData]);
                    setImportData(null);
                  }}
                >
                  إضافة إلى القائمة الحالية
                </button>
                <button 
                  className="w-full text-slate-400 py-2 font-bold hover:text-slate-600"
                  onClick={() => setImportData(null)}
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Journey Visualization Component ---
function JourneyVisualization({ student, history, onClose, showClose = true }: { student: Student, history: AttendanceHistory, onClose: () => void, showClose?: boolean }) {
  // Generate dates for the current month (1 to 31)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const dates = Array.from({ length: daysInMonth }).map((_, i) => {
    const d = new Date(year, month, i + 1);
    return d.toISOString().split('T')[0];
  });

  const studentHistory = dates.map(date => {
    const dayData = history[date] || [];
    const record = dayData.find(s => s.phone === student.phone);
    return { date, status: record?.status || 'none' };
  });

  const presentCount = studentHistory.filter(h => h.status === 'present').length;
  const absentCount = studentHistory.filter(h => h.status === 'absent').length;
  const lateCount = studentHistory.filter(h => h.status === 'late').length;
  const excusedCount = studentHistory.filter(h => h.status === 'excused').length;
  const progress = Math.min(100, ((presentCount + excusedCount) / daysInMonth) * 100);
  const points = presentCount * 5 + lateCount * 2 + excusedCount * 3;

  const currentMonthName = new Intl.DateTimeFormat('ar-SA', { month: 'long' }).format(new Date());

  return (
    <div className="journey-container-new">
      <div className="journey-header-new">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <h4 className="text-2xl font-black text-slate-800">رحلة الانضباط المدرسية</h4>
            <p className="text-slate-500 text-sm font-medium">تتبع حالة الحضور اليومي لشهر {currentMonthName}</p>
          </div>
        </div>
        {showClose && (
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <XCircle size={24} className="text-slate-400" />
          </button>
        )}
      </div>
      
      <div className="student-info-mini mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold flex-shrink-0">
            {student.name.charAt(0)}
          </div>
          <div className="overflow-hidden">
            <div className="font-bold text-slate-800 text-sm whitespace-nowrap overflow-hidden text-ellipsis">{student.name}</div>
            <div className="text-xs text-slate-500">{student.class}</div>
          </div>
        </div>
        <div className="text-left flex-shrink-0">
          <div className="text-xs text-slate-400">رقم الجوال</div>
          <div className="font-bold text-slate-700" style={{ fontSize: '14px' }}>{student.phone}</div>
        </div>
      </div>

      <div className="journey-timeline-wrapper">
        <div className="journey-line-base"></div>
        <div className="journey-line-active" style={{ width: `${progress}%` }}></div>
        
        <div className="journey-points-container overflow-x-auto pb-4 custom-scrollbar">
          <div className="flex justify-between min-w-[800px] px-2">
            {studentHistory.map((h, i) => (
              <div key={h.date} className="journey-point-item">
                <div 
                  className={`journey-point-dot ${h.status}`}
                  title={`${h.date}: ${h.status === 'present' ? 'حاضر' : h.status === 'absent' ? 'غائب' : h.status === 'late' ? 'متأخر' : h.status === 'excused' ? 'بعذر' : 'لم يسجل'}`}
                >
                  {h.status === 'present' && <Check size={10} className="text-white" />}
                  {h.status === 'absent' && <X size={10} className="text-white" />}
                  {h.status === 'late' && <Clock size={10} className="text-white" />}
                  {h.status === 'excused' && <Info size={10} className="text-white" />}
                </div>
                <div className="journey-point-date font-bold">
                  {i + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mt-12">
        <div className="journey-stat-card present">
          <div className="stat-label">حضور</div>
          <div className="stat-value">{presentCount}</div>
        </div>
        <div className="journey-stat-card absent">
          <div className="stat-label">غياب</div>
          <div className="stat-value">{absentCount}</div>
        </div>
        <div className="journey-stat-card late">
          <div className="stat-label">تأخير</div>
          <div className="stat-value">{lateCount}</div>
        </div>
        <div className="journey-stat-card excused">
          <div className="stat-label">بعذر</div>
          <div className="stat-value">{excusedCount}</div>
        </div>
        <div className="journey-stat-card points">
          <div className="stat-label">النقاط</div>
          <div className="stat-value">{points}</div>
        </div>
      </div>
    </div>
  );
}

// --- Reports Modal Component ---
function ReportsModal({ type, students, history, onClose }: { type: 'daily' | 'monthly' | 'student' | 'warning', students: Student[], history: AttendanceHistory, onClose: () => void }) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [selectedClass, setSelectedClass] = useState('all');
  const [monthlyResults, setMonthlyResults] = useState<{ studentName: string, class: string, present: number, absent: number, late: number }[] | null>(null);
  const reportRef = React.useRef<HTMLDivElement>(null);

  const classes = Array.from(new Set(students.map(s => s.class))).sort();

  const takeScreenshot = async () => {
    if (!reportRef.current) return;
    
    try {
      // Use html-to-image for better RTL support and text rendering
      const dataUrl = await toPng(reportRef.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: {
          fontFamily: "'Tajawal', sans-serif"
        },
        cacheBust: true,
      });

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `تقرير_طالب_${new Date().getTime()}.png`;
      link.click();
    } catch (error) {
      console.error('Error taking screenshot:', error);
      alert('حدث خطأ أثناء التقاط الصورة، يرجى المحاولة مرة أخرى');
    }
  };

  const generateDailyWordReport = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const present = students.filter(s => s.status === 'present');
      const absent = students.filter(s => s.status === 'absent');
      const late = students.filter(s => s.status === 'late');
      const excused = students.filter(s => s.status === 'excused');

      const doc = new Document({
        sections: [{
          properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              bidirectional: true,
              children: [new TextRun({ text: "المملكة العربية السعودية", bold: true, size: 24, font: "Tajawal" })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              bidirectional: true,
              children: [new TextRun({ text: "وزارة التعليم", bold: true, size: 24, font: "Tajawal" })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              bidirectional: true,
              children: [new TextRun({ text: "الإدارة العامة للتعليم بمحافظة الأحساء", bold: true, size: 24, font: "Tajawal" })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              bidirectional: true,
              children: [new TextRun({ text: "مدرسة الجشة المتوسطة", bold: true, size: 24, font: "Tajawal" })],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: "تقرير الحضور والغياب اليومي الإحصائي", bold: true, size: 36, font: "Tajawal", color: "0284c7" })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}`, size: 24, font: "Tajawal", color: "0891b2" })],
            }),
            new Paragraph({ text: "" }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ 
                      shading: { fill: "0ea5e9" },
                      children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "الحالة", bold: true, font: "Tajawal", size: 28, color: "ffffff" })] })] 
                    }),
                    new TableCell({ 
                      shading: { fill: "0ea5e9" },
                      children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "العدد", bold: true, font: "Tajawal", size: 28, color: "ffffff" })] })] 
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { fill: "f0f9ff" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "حاضر", font: "Tajawal", size: 28, color: "0369a1" })] })] }),
                    new TableCell({ shading: { fill: "f0f9ff" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(present.length), font: "Tajawal", size: 28, color: "0369a1" })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { fill: "fff1f2" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "غائب", font: "Tajawal", size: 28, color: "be123c" })] })] }),
                    new TableCell({ shading: { fill: "fff1f2" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(absent.length), font: "Tajawal", size: 28, color: "be123c" })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { fill: "fffbeb" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "متأخر", font: "Tajawal", size: 28, color: "b45309" })] })] }),
                    new TableCell({ shading: { fill: "fffbeb" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(late.length), font: "Tajawal", size: 28, color: "b45309" })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { fill: "f0fdf4" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "بعذر", font: "Tajawal", size: 28, color: "15803d" })] })] }),
                    new TableCell({ shading: { fill: "f0fdf4" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(excused.length), font: "Tajawal", size: 28, color: "15803d" })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { fill: "e0f2fe" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "الإجمالي", bold: true, font: "Tajawal", size: 28, color: "0c4a6e" })] })] }),
                    new TableCell({ shading: { fill: "e0f2fe" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(students.length), bold: true, font: "Tajawal", size: 28, color: "0c4a6e" })] })] }),
                  ],
                }),
              ],
            }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `تقرير_إحصائي_${today}.docx`);
    } catch (error) {
      console.error("Error generating Word report:", error);
      alert("حدث خطأ أثناء تصدير ملف Word");
    }
  };

  const generateDailyPdfReport = () => {
    const element = document.createElement('div');
    element.style.padding = '40px';
    element.style.direction = 'rtl';
    element.style.fontFamily = 'Tajawal, sans-serif';
    
    const today = new Date().toLocaleDateString('ar-SA');
    const presentCount = students.filter(s => s.status === 'present').length;
    const absentCount = students.filter(s => s.status === 'absent').length;
    const lateCount = students.filter(s => s.status === 'late').length;
    const excusedCount = students.filter(s => s.status === 'excused').length;
    
    element.innerHTML = `
      <div style="text-align: right; margin-bottom: 20px; font-size: 12px; font-weight: bold; color: #64748b;">
        <div>المملكة العربية السعودية</div>
        <div>وزارة التعليم</div>
        <div>الإدارة العامة للتعليم بمحافظة الأحساء</div>
        <div>مدرسة الجشة المتوسطة</div>
      </div>
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="font-size: 28px; color: #0ea5e9; margin-bottom: 10px; font-weight: 800;">تقرير الحضور والغياب اليومي الإحصائي</h1>
        <p style="font-size: 16px; color: #64748b;">التاريخ: ${today}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; direction: rtl; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
        <thead>
          <tr style="background-color: #0ea5e9; color: white;">
            <th style="padding: 15px; border: 1px solid #e0f2fe; text-align: right;">الحالة</th>
            <th style="padding: 15px; border: 1px solid #e0f2fe; text-align: center;">العدد</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 15px; border: 1px solid #f1f5f9;">حاضر</td>
            <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold;">${presentCount}</td>
          </tr>
          <tr style="background-color: #fff1f2;">
            <td style="padding: 15px; border: 1px solid #f1f5f9; color: #e11d48;">غائب</td>
            <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #e11d48;">${absentCount}</td>
          </tr>
          <tr style="background-color: #fffbeb;">
            <td style="padding: 15px; border: 1px solid #f1f5f9; color: #d97706;">متأخر</td>
            <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #d97706;">${lateCount}</td>
          </tr>
          <tr style="background-color: #f0fdf4;">
            <td style="padding: 15px; border: 1px solid #f1f5f9; color: #16a34a;">بعذر</td>
            <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #16a34a;">${excusedCount}</td>
          </tr>
          <tr style="background-color: #f8fafc; font-weight: 800; font-size: 18px;">
            <td style="padding: 15px; border: 1px solid #f1f5f9; color: #1e293b;">الإجمالي</td>
            <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; color: #1e293b;">${students.length}</td>
          </tr>
        </tbody>
      </table>
    `;
    
    const opt = {
      margin: 0.5,
      filename: `تقرير_إحصائي_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    
    (window as any).html2pdf().from(element).set(opt).save();
  };

  const handleDirectPrint = () => {
    try {
      let printHtml = '';
      
      if (type === 'student' && reportRef.current) {
        printHtml = reportRef.current.innerHTML;
      } else if (type === 'daily') {
        const presentCount = students.filter(s => s.status === 'present').length;
        const absentCount = students.filter(s => s.status === 'absent').length;
        const lateCount = students.filter(s => s.status === 'late').length;
        const excusedCount = students.filter(s => s.status === 'excused').length;
        
        printHtml = `
          <div style="text-align: right; margin-bottom: 20px;">
            <div>المملكة العربية السعودية</div>
            <div>وزارة التعليم</div>
            <div>الإدارة العامة للتعليم بمحافظة الأحساء</div>
            <div>مدرسة الجشة المتوسطة</div>
          </div>
          <h1 style="text-align: center; color: #0ea5e9; font-weight: 800;">تقرير الحضور والغياب اليومي الإحصائي</h1>
          <p style="text-align: center; color: #64748b;">التاريخ: ${new Date().toLocaleDateString('ar-SA')}</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 30px; direction: rtl; border-radius: 12px; overflow: hidden;">
            <thead>
              <tr style="background-color: #0ea5e9; color: white;">
                <th style="padding: 15px; border: 1px solid #e0f2fe; text-align: right;">الحالة</th>
                <th style="padding: 15px; border: 1px solid #e0f2fe; text-align: center;">العدد</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 15px; border: 1px solid #f1f5f9;">حاضر</td><td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold;">${presentCount}</td></tr>
              <tr style="background-color: #fff1f2;"><td style="padding: 15px; border: 1px solid #f1f5f9; color: #e11d48;">غائب</td><td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #e11d48;">${absentCount}</td></tr>
              <tr style="background-color: #fffbeb;"><td style="padding: 15px; border: 1px solid #f1f5f9; color: #d97706;">متأخر</td><td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #d97706;">${lateCount}</td></tr>
              <tr style="background-color: #f0fdf4;"><td style="padding: 15px; border: 1px solid #f1f5f9; color: #16a34a;">بعذر</td><td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; font-weight: bold; color: #16a34a;">${excusedCount}</td></tr>
              <tr style="background-color: #f8fafc; font-weight: 800; font-size: 18px;">
                <td style="padding: 15px; border: 1px solid #f1f5f9; color: #1e293b;">الإجمالي</td>
                <td style="padding: 15px; border: 1px solid #f1f5f9; text-align: center; color: #1e293b;">${students.length}</td>
              </tr>
            </tbody>
          </table>
        `;
      }

      if (!printHtml) {
        window.print();
        return;
      }

      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map(s => s.outerHTML)
        .join('');

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`
          <html dir="rtl">
            <head>
              <title>طباعة التقرير</title>
              <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
              ${styles}
              <style>
                body { margin: 0; padding: 20px; font-family: 'Tajawal', sans-serif; background: white; }
                @media print {
                  @page { margin: 1cm; }
                  body { padding: 0; }
                }
              </style>
            </head>
            <body>
              ${printHtml}
              <script>
                window.onload = function() {
                  setTimeout(() => {
                    window.print();
                    setTimeout(() => {
                      window.frameElement.remove();
                    }, 100);
                  }, 500);
                };
              </script>
            </body>
          </html>
        `);
        doc.close();
      }
    } catch (error) {
      console.error("Error in direct print:", error);
      alert("حدث خطأ أثناء محاولة الطباعة");
    }
  };
  const handleMonthlySearch = () => {
    if (!dateRange.from || !dateRange.to) {
      alert("يرجى تحديد نطاق التاريخ");
      return;
    }

    const results = students
      .filter(s => selectedClass === 'all' || s.class === selectedClass)
      .map(student => {
        let present = 0, absent = 0, late = 0;
        
        Object.entries(history).forEach(([date, dayStudents]) => {
          if (date >= dateRange.from && date <= dateRange.to) {
            const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
            if (record) {
              if (record.status === 'present') present++;
              else if (record.status === 'absent') absent++;
              else if (record.status === 'late') late++;
            }
          }
        });

        return {
          studentName: student.name,
          class: student.class,
          present,
          absent,
          late
        };
      });

    setMonthlyResults(results);
  };

  const generateMonthlyWordReport = async () => {
    if (!monthlyResults) return;

    const docGen = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "المملكة العربية السعودية", bold: true, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "وزارة التعليم", bold: true, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "الإدارة العامة للتعليم بمحافظة الأحساء", bold: true, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "مدرسة الجشة المتوسطة", bold: true, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [new TextRun({ text: "تقرير إحصائية الحضور والغياب للفترة", bold: true, size: 28, font: "Tajawal", color: "008375" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [new TextRun({ text: `من: ${dateRange.from} إلى: ${dateRange.to}`, size: 21, font: "Tajawal", color: "475569" })],
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "اسم الطالب", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "الفصل", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "حاضر", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "غائب", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "بعذر", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "008375" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: "متأخر", bold: true, font: "Tajawal", size: 21, color: "ffffff" })] })] 
                  }),
                ],
              }),
              ...monthlyResults.map((r, idx) => new TableRow({
                children: [
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true, children: [new TextRun({ text: r.studentName, font: "Tajawal", size: 21, color: "1e293b", bold: true })] })] }),
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: r.class, font: "Tajawal", size: 21, color: "1e293b" })] })] }),
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(r.present), font: "Tajawal", size: 21, color: "047857" })] })] }),
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(r.absent), font: "Tajawal", size: 21, color: "be123c", bold: true })] })] }),
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(r.excused || 0), font: "Tajawal", size: 21, color: "d97706" })] })] }),
                  new TableCell({ shading: { fill: idx % 2 === 0 ? "ffffff" : "f8fafc" }, children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: String(r.late), font: "Tajawal", size: 21, color: "b45309" })] })] }),
                ],
              })),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(docGen);
    saveAs(blob, `تقرير_فترة_${dateRange.from}_${dateRange.to}.docx`);
  };

  return (
    <div className="w-full">
      <div className="modal-header border-b-0 mb-0 pb-0">
        <button onClick={onClose} className="close-btn text-slate-400 hover:text-slate-600 transition-colors">×</button>
        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800">
          {type === 'daily' && <><span className="text-red-500"><Printer size={24} /></span> التقرير الشامل (طباعة / Word / PDF)</>}
          {type === 'monthly' && <><Calendar /> تقرير غياب لفترة</>}
          {type === 'student' && <><Users /> تقرير غياب طالب</>}
          {type === 'warning' && <><AlertCircle /> تقرير الطلاب المنذرين</>}
        </h3>
      </div>

      {type === 'daily' && (
        <div className="space-y-6 pt-2">
          <p className="text-center text-slate-400 text-sm font-medium px-4">
            سيتم إنشاء تقرير شامل يحتوي على جميع بيانات الحضور والغياب الحالية.
          </p>
          
          <div className="bg-[#f8fbfe] border border-[#e8f1f9] rounded-2xl p-6 mx-2">
            <div className="grid grid-cols-2 gap-y-6 gap-x-8">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold text-sm">إجمالي الطلاب:</span>
                <span className="text-slate-800 font-black text-lg">{students.length}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold text-sm">الحاضرين:</span>
                <span className="text-[#10b981] font-black text-lg">{students.filter(s => s.status === 'present').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold text-sm">الغائبين:</span>
                <span className="text-[#f43f5e] font-black text-lg">{students.filter(s => s.status === 'absent').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold text-sm">المتأخرين:</span>
                <span className="text-[#f59e0b] font-black text-lg">{students.filter(s => s.status === 'late').length}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 px-2">
            <button 
              className="flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 border-2 border-red-100 py-3.5 rounded-2xl font-black text-sm transition-all shadow-sm active:scale-95"
              onClick={generateDailyPdfReport}
            >
              <FileDown size={20} />
              تحميل PDF
            </button>
            <button 
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white py-3.5 rounded-2xl font-black text-sm transition-all shadow-lg shadow-indigo-100 active:scale-95"
              onClick={generateDailyWordReport}
            >
              <FileText size={20} />
              تصدير Word
            </button>
          </div>

          <div className="px-2 space-y-3">
            <button 
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-lg shadow-slate-200 active:scale-95"
              onClick={handleDirectPrint}
            >
              <Printer size={20} />
              طباعة مباشرة
            </button>
            <button 
              className="w-full py-3.5 rounded-2xl font-black text-sm text-slate-400 border border-slate-100 hover:bg-slate-50 transition-all"
              onClick={onClose}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {type === 'monthly' && (
        <div className="space-y-6">
          <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100/50 space-y-4">
            <div className="flex items-center gap-2 text-indigo-900 font-black text-sm mb-1">
              <Filter size={16} />
              تصفية البيانات
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="form-label text-[10px]">الفصل الدراسي</label>
                <select 
                  className="form-select bg-white" 
                  value={selectedClass} 
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="all">جميع الفصول</option>
                  {classes.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-[10px]">من تاريخ</label>
                  <input 
                    type="date" 
                    className="form-input bg-white" 
                    value={dateRange.from}
                    onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label text-[10px]">إلى تاريخ</label>
                  <input 
                    type="date" 
                    className="form-input bg-white" 
                    value={dateRange.to}
                    onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <button className="modal-btn bg-indigo-600 hover:bg-indigo-700 w-full" onClick={handleMonthlySearch}>
              استخراج التقرير الإحصائي
            </button>
          </div>

          {monthlyResults && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center justify-between px-1">
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider">نتائج البحث ({monthlyResults.length})</div>
                <div className="text-[10px] text-slate-400 font-bold">{dateRange.from} ↔ {dateRange.to}</div>
              </div>
              <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-2xl shadow-sm">
                <table className="report-table-custom m-0">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr>
                      <th className="text-right">الطالب</th>
                      <th>حاضر</th>
                      <th>غائب</th>
                      <th>متأخر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyResults.map((r) => (
                      <tr key={r.studentId}>
                        <td className="text-right text-xs font-bold text-slate-700">{r.studentName}</td>
                        <td className="text-green-600 font-black">{r.present}</td>
                        <td className="text-red-600 font-black">{r.absent}</td>
                        <td className="text-yellow-600 font-black">{r.late}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="modal-btn bg-slate-800 hover:bg-slate-900 flex items-center justify-center gap-2" onClick={generateMonthlyWordReport}>
                <FileText size={18} />
                تصدير التقرير للفترة (Word)
              </button>
            </div>
          )}
        </div>
      )}

      {type === 'student' && (
        <div className="space-y-6">
          <div>
            <label className="form-label">ابحث أو اختر الطالب من القائمة الحالية:</label>
            <select 
              className="form-select" 
              value={selectedStudentId} 
              onChange={(e) => setSelectedStudentId(e.target.value)}
            >
              <option value="">-- يرجى اختيار الطالب --</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name} - {s.class}</option>)}
            </select>
          </div>

          {selectedStudentId && (() => {
            const student = students.find(s => s.id === selectedStudentId);
            if (!student) return null;
            
            const studentHistory = Object.entries(history).map(([date, dayStudents]) => {
              const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
              return record ? { date, status: record.status } : null;
            }).filter(Boolean) as { date: string, status: string }[];
            
            const cumulativeAbsence = studentHistory.filter(h => h.status === 'absent').length;

            return (
              <div className="relative">
                <div className="screenshot-btn-custom" onClick={takeScreenshot} title="لقطة شاشة">
                  <Share2 size={20} />
                </div>
                
                <div ref={reportRef} className="bg-white p-2">
                  <div className="student-report-card">
                    <div className="flex justify-end mb-6">
                      <div className="text-left">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">إشعار رسمي</div>
                        <div className="text-xs font-black text-slate-800">نظام المواظبة المدرسية</div>
                      </div>
                    </div>

                    <h2 className="text-lg font-black text-center mb-6 text-slate-800 border-b-2 border-slate-100 pb-4">إشعار حضور وغياب وتأخر</h2>
                    
                    <div className="report-info-grid">
                      <div className="info-row">
                        <span className="info-label text-sky-600">اسم الطالب</span> 
                        <span className="info-value text-slate-800 font-black">{student.name}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label text-teal-600">الصف الدراسي</span> 
                        <span className="info-value text-slate-800 font-black">{student.class}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label text-amber-600">رقم التواصل</span> 
                        <div className="info-value text-slate-800 font-black mt-1" dir="ltr">{student.phone}</div>
                      </div>
                      <div className="info-row">
                        <span className="info-label text-indigo-600">تاريخ التقرير</span> 
                        <span className="info-value text-slate-800 font-black">{new Date().toLocaleDateString('ar-SA')}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label text-sky-600">حالة الحضور اليوم</span> 
                        <span className={`info-value font-black ${
                          student.status === 'present' ? 'text-emerald-600' : 
                          student.status === 'absent' ? 'text-rose-600' : 
                          student.status === 'late' ? 'text-amber-600' : 'text-slate-600'
                        }`}>
                          {student.status === 'present' ? 'حاضر' : student.status === 'absent' ? 'غائب' : student.status === 'late' ? 'متأخر' : student.status === 'excused' ? 'بعذر' : 'لم يسجل'}
                        </span>
                      </div>
                      <div className="info-row">
                        <span className="info-label text-rose-600">إجمالي أيام الغياب</span> 
                        <span className="info-value text-rose-600 font-black">{cumulativeAbsence} أيام</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 mb-6">
                      <p className="text-xs text-slate-600 leading-relaxed text-center font-medium">
                        يُعتبر هذا الإشعار بمثابة تبليغ رسمي لولي الأمر بمتابعة سجل حضور وانصراف الطالب. 
                        نأمل التعاون المستمر والحرص على انتظام الطالب لما فيه مصلحته التعليمية والتربوية.
                      </p>
                    </div>

                    <div className="flex justify-center pt-6 border-t border-slate-100">
                      <div className="text-[10px] text-slate-400 font-bold">صدر بواسطة: الإدارة المدرسية</div>
                    </div>
                  </div>
                  
                  <div className="scale-90 origin-top">
                    <JourneyVisualization student={student} history={history} onClose={() => {}} showClose={false} />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {type === 'warning' && (
        <div className="space-y-4">
          <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-3 mb-2">
            <AlertTriangle className="text-red-500" size={20} />
            <p className="text-xs text-red-700 font-bold">
              قائمة الطلاب الذين تجاوزت غياباتهم الحد المسموح (3 أيام فأكثر)
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
            {students.filter(s => s.absentCount > 3).map(s => (
              <div key={s.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 hover:border-red-200 transition-colors shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-black text-xs">
                    {s.absentCount}
                  </div>
                  <div>
                    <div className="font-black text-slate-800">{s.name}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{s.class}</div>
                  </div>
                </div>
                <div className="bg-red-600 text-white px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider">
                  إنذار نهائي
                </div>
              </div>
            ))}
            {students.filter(s => s.absentCount > 3).length === 0 && (
              <div className="text-center py-16">
                <ShieldCheck size={48} className="mx-auto text-slate-100 mb-4" />
                <p className="text-slate-400 font-bold">لا يوجد طلاب منذرين حالياً.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Student Portal ---
function StudentPortal({ student, students, history, onDeleteRecord, onUpdateExcuses, onLogout }: { 
  student: Student, 
  students: Student[], 
  history: AttendanceHistory, 
  onDeleteRecord: (phone: string, date: string) => void,
  onUpdateExcuses: (id: string, excuses: Excuse[]) => void,
  onLogout: () => void 
}) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'log' | 'excuses' | 'profile'>('dashboard');
  const [showExcuseModal, setShowExcuseModal] = useState(false);
  const [showNoorAlert, setShowNoorAlert] = useState(false);
  const [excuseStatusNotification, setExcuseStatusNotification] = useState<Excuse | null>(null);
  const [showLoginAlert, setShowLoginAlert] = useState(false);
  const [newExcuse, setNewExcuse] = useState({ type: 'عذر طبي', detail: '', date: new Date().toISOString().split('T')[0], fileName: '', fileData: '' });

  const studentHistory = Object.entries(history)
    .map(([date, dayStudents]) => {
      const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
      return record ? { date, ...record } : null;
    })
    .filter(Boolean) as (Student & { date: string })[];

  const sortedHistory = [...studentHistory].sort((a, b) => b.date.localeCompare(a.date));

  const currentStudent = students.find(s => s.id === student.id) || student;
  const studentExcuses = currentStudent.excuses || [];

  useEffect(() => {
    const unnotifiedExcuse = studentExcuses.find(e => e.status !== 'pending' && !e.notified);
    if (unnotifiedExcuse) {
      setExcuseStatusNotification(unnotifiedExcuse);
      // Mark as notified
      const updatedExcuses = studentExcuses.map(e => 
        e.id === unnotifiedExcuse.id ? { ...e, notified: true } : e
      );
      onUpdateExcuses(student.id, updatedExcuses);
    }
  }, [studentExcuses, student.id, onUpdateExcuses]);

  const todayDate = new Date().toISOString().split('T')[0];
  const isTodayAbsent = currentStudent.status === 'absent';
  const isTodayLate = currentStudent.status === 'late';
  const isTodayHasExcuse = studentExcuses.some(e => e.date === todayDate);

  const unexcusedAbsences = [
    ...studentHistory.filter(h => 
      h.status === 'absent' && 
      !studentExcuses.some(e => e.date === h.date)
    ),
    ...(isTodayAbsent && !isTodayHasExcuse ? [{ date: todayDate, status: 'absent' }] : [])
  ];

  const unexcusedLateness = [
    ...studentHistory.filter(h => 
      h.status === 'late' && 
      !studentExcuses.some(e => e.date === h.date)
    ),
    ...(isTodayLate && !isTodayHasExcuse ? [{ date: todayDate, status: 'late' }] : [])
  ];

  useEffect(() => {
    if (unexcusedAbsences.length > 0 || unexcusedLateness.length > 0) {
      setShowLoginAlert(true);
    }
  }, []);

  const stats = {
    attendanceRate: (studentHistory.length + 1) > 0 ? Math.round(((studentHistory.filter(h => h.status === 'present').length + (currentStudent.status === 'present' ? 1 : 0)) / (studentHistory.length + 1)) * 100) : 100,
    absenceDays: studentHistory.filter(h => h.status === 'absent').length + (isTodayAbsent ? 1 : 0),
    delayTimes: studentHistory.filter(h => h.status === 'late').length + (isTodayLate ? 1 : 0),
    excusedAbsence: studentExcuses.filter(e => e.status === 'approved').length
  };

  const disciplineScore = Math.max(0, 100 - stats.absenceDays);

  const handleAddExcuse = () => {
    if (!newExcuse.detail) {
      alert('يرجى كتابة تفاصيل العذر');
      return;
    }
    const excuse: Excuse = {
      id: Math.random().toString(36).substr(2, 9),
      type: newExcuse.type,
      detail: newExcuse.detail,
      date: newExcuse.date,
      status: 'pending',
      fileName: newExcuse.fileName,
      fileData: newExcuse.fileData
    };
    onUpdateExcuses(student.id, [...studentExcuses, excuse]);
    setShowExcuseModal(false);
    setNewExcuse({ type: 'عذر طبي', detail: '', date: new Date().toISOString().split('T')[0], fileName: '', fileData: '' });
    alert('تم رفع العذر بنجاح وهو قيد المراجعة');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewExcuse({ 
          ...newExcuse, 
          fileName: file.name, 
          fileData: event.target?.result as string 
        });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="portal-layout">
      {/* Sidebar */}
      <aside className="portal-sidebar">
        <div className="portal-logo">
          <ShieldCheck size={32} />
          <span>بوابة المواظبة</span>
        </div>
        
        <nav className="portal-nav">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutGrid size={20} />
            <span>ملخص المواظبة</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            <CalendarCheck size={20} />
            <span>سجل الغياب والتأخير</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'excuses' ? 'active' : ''}`}
            onClick={() => setActiveTab('excuses')}
          >
            <FileText size={20} />
            <span>الأعذار والمبررات</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={20} />
            <span>الملف الشخصي</span>
          </div>
        </nav>

        <div className="portal-sidebar-footer">
          <button onClick={onLogout} className="btn btn-outline w-full justify-center text-red-600 border-red-100 hover:bg-red-50">
            <LogOut size={18} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="portal-main">
        <header className="portal-header">
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-black text-slate-900">{student.class}</div>
              <div className="text-[10px] text-slate-500">{student.name}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Bell size={16} />
            </div>
          </div>
          
          <div className="portal-search">
            <Search size={18} />
            <input type="text" placeholder="البحث في السجلات..." />
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="mb-8">
                <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
                  ملخص المواظبة
                  <BarChart3 className="text-indigo-600" />
                </h2>
                <p className="text-slate-500">نظرة عامة على حالة الحضور والغياب للفصل الدراسي الحالي</p>
              </div>

              <div className="portal-stats-grid">
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-green-50 text-green-500">
                    <CheckCircle size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>نسبة الحضور</h4>
                    <div className="value">{stats.attendanceRate}%</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-red-50 text-red-500">
                    <XCircle size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>أيام الغياب</h4>
                    <div className="value">{stats.absenceDays} أيام</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-orange-50 text-orange-500">
                    <Clock size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>مرات التأخير</h4>
                    <div className="value">{stats.delayTimes} مرات</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-blue-50 text-blue-500">
                    <FileText size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>غياب بعذر</h4>
                    <div className="value">{stats.excusedAbsence} أيام</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2">
                  <div className="discipline-card">
                    <div className="discipline-header">
                      <h3 className="font-bold">مؤشر الانضباط المدرسي</h3>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-1 text-green-600 text-xs font-bold">
                          <CheckCircle size={14} />
                          <span>حضور</span>
                        </div>
                        <div className="flex items-center gap-1 text-red-600 text-xs font-bold">
                          <XCircle size={14} />
                          <span>غياب</span>
                        </div>
                        <div className="flex items-center gap-1 text-yellow-500 text-xs font-bold">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span>متأخر</span>
                        </div>
                      </div>
                    </div>
                    <div className="discipline-progress-bg">
                      <div className="discipline-progress-fill" style={{ width: `${stats.attendanceRate}%` }}></div>
                    </div>
                    <div className="discipline-labels">
                      <span>غياب ({100 - stats.attendanceRate}%)</span>
                      <span>مواظب ({stats.attendanceRate}%)</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-8">
                      <div className="bg-slate-50 p-4 rounded-xl text-center">
                        <div className="text-xs text-slate-500 mb-1">بيئة المواظبة</div>
                        <div className="text-xl font-black text-indigo-600">{disciplineScore} / 100</div>
                        <div className="text-[10px] text-green-500 mt-1">{disciplineScore > 90 ? 'أداء متميز' : disciplineScore > 75 ? 'أداء جيد' : 'يحتاج تحسين'}</div>
                      </div>
                      <div className="bg-indigo-50 p-4 rounded-xl text-center flex flex-col justify-center items-center min-h-[100px] border border-indigo-100">
                        <div className="text-indigo-600 mb-2">
                          <Sparkles size={20} className="mx-auto" />
                        </div>
                        <div className="text-sm font-bold text-slate-800 leading-relaxed px-2">
                          {disciplineScore >= 95 ? 'أنت نموذج للمواظبة! استمر في هذا التألق والحضور المبكر دائماً.' :
                           disciplineScore >= 85 ? 'رائع جداً! استمر في المحافظة على رصيدك المتميز من الانضباط.' :
                           disciplineScore >= 70 ? 'أداء جيد! التزم بالحضور المبكر يومياً لتصل إلى قائمة المتميزين.' :
                           'مستقبلك يبدأ بحضورك، كن بطلاً وحافظ على التواجد مبكراً في مدرستك.'}
                        </div>
                        <div className="text-[10px] text-indigo-400 mt-2 font-medium">رسالة تحفيزية</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-span-1">
                  <div className="recent-log-card mb-6">
                    <JourneyVisualization student={student} history={history} onClose={() => {}} showClose={false} />
                  </div>

                  <div className="recent-log-card">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold">سجل حديث</h3>
                      <button className="text-indigo-600 text-xs font-bold" onClick={() => setActiveTab('log')}>عرض الكل</button>
                    </div>
                    <div className="space-y-4">
                      {sortedHistory.slice(0, 3).map((h) => (
                        <div key={h.date} className="log-item">
                          <div className="log-item-info">
                            <div className={`log-icon ${h.status === 'present' ? 'bg-green-50 text-green-500' : h.status === 'absent' ? 'bg-red-50 text-red-500' : 'bg-orange-50 text-orange-500'}`}>
                              {h.status === 'present' ? <CheckCircle size={18} /> : h.status === 'absent' ? <XCircle size={18} /> : <Clock size={18} />}
                            </div>
                            <div>
                              <div className="text-sm font-bold flex items-center gap-1">
                                {h.status === 'present' ? 'حضور' : h.status === 'absent' ? 'غياب' : 'متأخر'}
                                {(h.status === 'absent' || h.status === 'late') && studentExcuses.find(e => e.date === h.date)?.status === 'approved' && (
                                  <ShieldCheck size={12} className="text-green-500" />
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400">{h.date}</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-slate-300" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'log' && (
            <motion.div 
              key="log"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black mb-2">سجل الغياب والتأخير</h2>
                  <p className="text-slate-500">عرض تفصيلي لجميع سجلات الحضور والغياب</p>
                </div>
                <div className="flex gap-2">
                  <select className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold outline-none">
                    <option>الفصل الدراسي الحالي</option>
                  </select>
                  <select className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold outline-none">
                    <option>جميع السجلات</option>
                  </select>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>المدة / الوقت</th>
                      <th>الحالة / العذر</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory.map((h) => (
                      <tr key={h.date}>
                        <td className="font-bold text-slate-700">{h.date}</td>
                        <td>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black ${
                            h.status === 'present' ? 'bg-green-100 text-green-600' : 
                            h.status === 'absent' ? 'bg-red-100 text-red-600' : 
                            'bg-orange-100 text-orange-600'
                          }`}>
                            {h.status === 'present' ? 'حضور' : h.status === 'absent' ? 'غياب' : 'متأخر'}
                          </span>
                        </td>
                        <td className="text-slate-500 text-sm">{h.time || '-'}</td>
                        <td className="text-slate-500 text-sm">
                          {h.status === 'absent' ? (
                            (() => {
                              const excuse = studentExcuses.find(e => e.date === h.date);
                              if (excuse?.status === 'approved') {
                                return (
                                  <div className="flex items-center gap-1 text-green-600 font-bold">
                                    <ShieldCheck size={14} />
                                    <span>عذر مقبول</span>
                                  </div>
                                );
                              } else if (excuse?.status === 'pending') {
                                return (
                                  <div className="flex items-center gap-1 text-indigo-600 font-bold">
                                    <Clock size={14} />
                                    <span>تم تقديم العذر</span>
                                  </div>
                                );
                              } else if (excuse?.status === 'rejected') {
                                return (
                                  <div className="flex items-center gap-1 text-red-600 font-bold">
                                    <XCircle size={14} />
                                    <span>عذر مرفوض</span>
                                  </div>
                                );
                              }
                              return <span className="text-red-400">بدون عذر</span>;
                            })()
                          ) : h.status === 'late' ? (
                            (() => {
                              const excuse = studentExcuses.find(e => e.date === h.date);
                              if (excuse?.status === 'approved') {
                                return (
                                  <div className="flex items-center gap-1 text-green-600 font-bold">
                                    <ShieldCheck size={14} />
                                    <span>تأخر مقبول</span>
                                  </div>
                                );
                              } else if (excuse?.status === 'pending') {
                                return (
                                  <div className="flex items-center gap-1 text-indigo-600 font-bold">
                                    <Clock size={14} />
                                    <span>تم تقديم العذر</span>
                                  </div>
                                );
                              } else if (excuse?.status === 'rejected') {
                                return (
                                  <div className="flex items-center gap-1 text-red-600 font-bold">
                                    <XCircle size={14} />
                                    <span>تأخر غير مقبول</span>
                                  </div>
                                );
                              }
                              return <span className="text-orange-400">تأخر غير مبرر</span>;
                            })()
                          ) : (
                            <span className="text-green-500">في الوقت المحدد</span>
                          )}
                        </td>
                        <td>
                          <div className="flex gap-2">
                            {h.status === 'absent' && !studentExcuses.find(e => e.date === h.date) && (
                              <button 
                                onClick={() => {
                                  setNewExcuse(prev => ({ ...prev, date: h.date }));
                                  setActiveTab('excuses');
                                  setShowExcuseModal(true);
                                }}
                                className="text-indigo-600 text-xs font-bold bg-indigo-50 px-3 py-1 rounded-lg hover:bg-indigo-100 transition-colors"
                              >
                                تقديم عذر
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sortedHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-slate-400">لا توجد سجلات حالياً.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'excuses' && (
            <motion.div 
              key="excuses"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black mb-2">الأعذار والمبررات</h2>
                  <p className="text-slate-500">تقديم ومتابعة حالة الأعذار الطبية أو العائلية لأيام الغياب</p>
                </div>
                <button 
                  onClick={() => setShowExcuseModal(true)}
                  className="btn btn-primary px-6 py-3 rounded-xl shadow-lg shadow-indigo-200"
                >
                  <FilePlus size={20} />
                  رفع عذر جديد
                </button>
              </div>

              <div className="excuse-grid">
                {studentExcuses.map(excuse => (
                  <div key={excuse.id} className={`excuse-card ${excuse.status === 'approved' ? 'accepted' : excuse.status === 'rejected' ? 'rejected' : 'pending'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <span className={`excuse-status ${
                        excuse.status === 'approved' ? 'bg-green-100 text-green-600' : 
                        excuse.status === 'rejected' ? 'bg-red-100 text-red-600' : 
                        'bg-orange-100 text-orange-600'
                      }`}>
                        {excuse.status === 'approved' ? 'مقبول' : excuse.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                      </span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Calendar size={12} />
                        {excuse.date}
                      </span>
                    </div>
                    <h3 className="text-lg font-black mb-2">{excuse.type}</h3>
                    <p className="text-sm text-slate-500 mb-6">{excuse.detail}</p>
                    <button className="text-indigo-600 text-xs font-bold flex items-center gap-1 hover:underline">
                      عرض المرفقات
                      <ArrowLeft size={14} />
                    </button>
                  </div>
                ))}
                {studentExcuses.length === 0 && (
                  <div className="col-span-full text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                    <p className="text-slate-500">لا توجد أعذار مقدمة حالياً.</p>
                  </div>
                )}
              </div>

              {showExcuseModal && (
                <AnimatePresence>
                  <div className="modal-overlay">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="modal-box max-w-md"
                    >
                      <div className="modal-header">
                        <h3>رفع عذر جديد</h3>
                        <button className="close-btn" onClick={() => setShowExcuseModal(false)}>×</button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="form-label">نوع العذر</label>
                          <select 
                            className="form-select"
                            value={newExcuse.type}
                            onChange={(e) => setNewExcuse({ ...newExcuse, type: e.target.value })}
                          >
                            <option>عذر طبي</option>
                            <option>عذر عائلي</option>
                            <option>ظرف طارئ</option>
                          </select>
                        </div>
                        <div>
                          <label className="form-label">التاريخ</label>
                          <input 
                            type="date" 
                            className="form-input"
                            value={newExcuse.date}
                            onChange={(e) => setNewExcuse({ ...newExcuse, date: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="form-label">التفاصيل</label>
                          <textarea 
                            className="form-input min-h-[100px]"
                            placeholder="اشرح سبب الغياب بالتفصيل..."
                            value={newExcuse.detail}
                            onChange={(e) => setNewExcuse({ ...newExcuse, detail: e.target.value })}
                          ></textarea>
                        </div>
                        <div>
                          <label className="form-label">إرفاق مستند (صورة أو PDF)</label>
                          <input 
                            id="excuse-file-upload"
                            type="file" 
                            className="hidden" 
                            accept="image/*,.pdf"
                            onChange={handleFileChange}
                          />
                          <label 
                            htmlFor="excuse-file-upload"
                            className={`file-upload-box block ${newExcuse.fileName ? 'border-indigo-500 bg-indigo-50' : ''}`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <Upload size={24} className={newExcuse.fileName ? 'text-indigo-600' : 'text-slate-400'} />
                              <span className={`text-xs font-bold ${newExcuse.fileName ? 'text-indigo-700' : 'text-slate-500'}`}>
                                {newExcuse.fileName || 'اضغط لرفع الملف'}
                              </span>
                            </div>
                          </label>
                        </div>
                        <button 
                          onClick={handleAddExcuse}
                          disabled={!newExcuse.fileName || !newExcuse.detail}
                          className={`modal-btn ${(!newExcuse.fileName || !newExcuse.detail) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          إرسال العذر للمراجعة
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </AnimatePresence>
              )}
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="profile-hero">
                <div className="profile-avatar-container">
                  <div className="w-full h-full bg-slate-50 flex items-center justify-center">
                    <User size={60} className="text-slate-200" />
                  </div>
                  <div className="profile-avatar-badge">
                    <ShieldCheck size={18} />
                  </div>
                </div>
                <h2 className="text-2xl font-black mb-1">{student.class}</h2>
                <p className="text-slate-500">{student.name}</p>
              </div>

              <div className="profile-info-card">
                <div className="flex items-center gap-2 mb-8 pb-4 border-bottom border-slate-100">
                  <Info className="text-indigo-600" size={20} />
                  <h3 className="font-black">معلومات الطالب</h3>
                  <span className="mr-auto px-3 py-1 bg-green-100 text-green-600 text-[10px] font-black rounded-full">منتظم</span>
                </div>

                <div className="profile-grid">
                  <div className="profile-field">
                    <label>رقم الجوال</label>
                    <span dir="ltr" style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginTop: '4px' }}>{student.phone}</span>
                  </div>
                  <div className="profile-field">
                    <label>المدرسة</label>
                    <span>مدرسة الجشة المتوسطة</span>
                  </div>
                </div>

                <button 
                  onClick={() => setShowNoorAlert(true)}
                  className="w-full mt-8 py-4 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
                >
                  تحديث بيانات التواصل
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showNoorAlert && (
          <div className="modal-overlay active" onClick={() => setShowNoorAlert(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="modal-box max-w-md p-8 text-center rounded-3xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Info size={40} />
              </div>
              
              <h3 className="text-xl font-black text-slate-900 mb-4">تحديث البيانات</h3>
              <p className="text-slate-600 leading-relaxed mb-8 font-bold">
                عزيزي ولي الأمر، لتحديث بيانات التواصل الخاصة بالطالب، يُرجى التحديث عبر نظام نور الرسمي في المدرسة.
              </p>

              <button 
                onClick={() => setShowNoorAlert(false)}
                className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
              >
                حسناً، فهمت
              </button>
            </motion.div>
          </div>
        )}

        {showLoginAlert && (
          <div className="modal-overlay active" onClick={() => setShowLoginAlert(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="modal-box max-w-md p-8 text-center rounded-3xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-24 h-24 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle size={48} />
              </div>
              
              <h3 className="text-2xl font-black text-slate-900 mb-2">تنبيه</h3>
              <p className="text-slate-500 font-bold mb-6">عزيزي ولي الأمر</p>
              
              <p className="text-slate-600 leading-relaxed mb-8">
                {isTodayAbsent && !isTodayHasExcuse ? (
                  <>تفيد بغياب الطالب لهذا اليوم <span className="text-indigo-600 font-black">({student.name})</span>، يجب عليك تقديم عذر مقبول.</>
                ) : isTodayLate && !isTodayHasExcuse ? (
                  <>تفيد بتأخر <span className="text-indigo-600 font-black">({student.name})</span> الآن عن الحضور للمدرسة مبكراً، من دون تقديم أي عذر.</>
                ) : (
                  <>يوجد لدى الطالب/ة <span className="text-indigo-600 font-black">({student.name})</span> عدد <span className="text-red-600 font-black">[{unexcusedAbsences.length + unexcusedLateness.length}]</span> من سجلات {unexcusedAbsences.length > 0 && unexcusedLateness.length > 0 ? 'الغياب والتأخير' : unexcusedAbsences.length > 0 ? 'الغياب' : 'التأخير'} دون عذر مسجل في النظام.</>
                )}
                <br />
                يُرجى التكرم بالانتقال إلى قسم "الأعذار والمبررات" وتقديم العذر اللازم.
              </p>

              <div className="space-y-3">
                <button 
                  onClick={() => {
                    setActiveTab('excuses');
                    setShowLoginAlert(false);
                  }}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                >
                  الانتقال لقسم الأعذار
                </button>
                <button 
                  onClick={() => setShowLoginAlert(false)}
                  className="w-full py-2 text-slate-400 font-bold hover:text-slate-600 transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Excuse Status Notification Modal */}
        {excuseStatusNotification && (
          <div className="modal-overlay active" onClick={() => setExcuseStatusNotification(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center relative"
              onClick={e => e.stopPropagation()}
            >
              <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${
                excuseStatusNotification.status === 'approved' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
              }`}>
                {excuseStatusNotification.status === 'approved' ? <ShieldCheck size={40} /> : <XCircle size={40} />}
              </div>
              <h3 className="text-2xl font-black mb-2">
                {excuseStatusNotification.status === 'approved' ? 'تم قبول عذرك' : 'تم رفض عذرك'}
              </h3>
              <p className="text-slate-500 mb-8 font-bold">
                {excuseStatusNotification.status === 'approved' 
                  ? `تمت الموافقة على العذر المقدم لتاريخ ${excuseStatusNotification.date}`
                  : `نعتذر، تم رفض العذر المقدم لتاريخ ${excuseStatusNotification.date}. يرجى مراجعة الإدارة.`}
              </p>
              <button 
                onClick={() => setExcuseStatusNotification(null)}
                className={`w-full py-4 rounded-xl font-black text-lg transition-all ${
                  excuseStatusNotification.status === 'approved' 
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-100' 
                  : 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-100'
                }`}
              >
                حسناً، فهمت
              </button>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Helper Components ---
function StatCard({ title, value, icon, color }: { title: string, value: number, icon: React.ReactNode, color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-info">
        <h3>{title}</h3>
        <p className={`text-${color}`}>{value}</p>
      </div>
      <div className={`stat-icon bg-${color}-light text-${color}`}>
        {icon}
      </div>
    </div>
  );
}
