import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { safeApiFetch } from "../../lib/api-client";
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  User,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Loader2,
  Key,
  Clock,
  Ban,
  Search,
  Trash2,
  Edit3,
  Check,
  Eye,
  EyeOff,
  Copy,
  Laptop,
  Smartphone,
  LogOut,
  History,
} from "lucide-react";

interface ActiveDeviceSummary {
  id: string;
  deviceName: string;
  browser: string;
  operatingSystem: string;
  status: "ACTIVE" | "PENDING" | "REVOKED";
  lastSeenAt: string;
}

interface AdminLoginRequestItem {
  id: string;
  userId: string;
  deviceId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "USER" | "ADMIN";
    status: "PENDING" | "ACTIVE" | "DEACTIVATED";
  };
  device: {
    id: string;
    deviceName: string;
    browser: string;
    operatingSystem: string;
    status: "ACTIVE" | "PENDING" | "REVOKED";
    lastSeenAt: string;
    createdAt: string;
    revokedAt: string | null;
  };
  currentActiveDevice: ActiveDeviceSummary | null;
  reviewer: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}

interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  status: "PENDING" | "ACTIVE" | "DEACTIVATED";
  passwordPlain?: string | null;
  createdAt: string;
  updatedAt?: string;
  documentCount: number;
  exportCount: number;
  pendingDeviceRequests?: number;
  activeDevice?: ActiveDeviceSummary | null;
}

type StatusFilter = "ALL" | "PENDING" | "ACTIVE" | "DEACTIVATED" | "ADMIN";

export const AdminUserManagement: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loginRequests, setLoginRequests] = useState<AdminLoginRequestItem[]>([]);
  const [showDeviceHistory, setShowDeviceHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter & Search
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Password visibility in table
  const [showAllPasswords, setShowAllPasswords] = useState(false);
  const [visiblePasswordMap, setVisiblePasswordMap] = useState<Record<string, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUserForReset, setSelectedUserForReset] = useState<ManagedUser | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<ManagedUser | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUserForDelete, setSelectedUserForDelete] = useState<ManagedUser | null>(null);

  // New user form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<"USER" | "ADMIN">("USER");
  const [newStatus, setNewStatus] = useState<"ACTIVE" | "PENDING" | "DEACTIVATED">("ACTIVE");

  // Edit user form state
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editStatus, setEditStatus] = useState<"PENDING" | "ACTIVE" | "DEACTIVATED">("ACTIVE");

  // Reset password form state
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [showResetPasswordInput, setShowResetPasswordInput] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const [usersRes, reqsRes] = await Promise.all([
        safeApiFetch<{ success: boolean; users: ManagedUser[]; error?: string }>("/api/admin/users"),
        safeApiFetch<{ success: boolean; loginRequests: AdminLoginRequestItem[]; error?: string }>(
          "/api/admin/login-requests"
        ),
      ]);

      if (usersRes.ok && usersRes.data?.success) {
        setUsers(usersRes.data.users);
      } else {
        setErrorMessage(usersRes.error || usersRes.data?.error || "Gagal memuat data pengguna.");
      }

      if (reqsRes.ok && reqsRes.data?.success) {
        setLoginRequests(reqsRes.data.loginRequests);
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat memuat daftar pengguna.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const pendingDeviceLoginRequests = useMemo(
    () => loginRequests.filter((r) => r.status === "PENDING"),
    [loginRequests]
  );

  const historyDeviceLoginRequests = useMemo(
    () => loginRequests.filter((r) => r.status !== "PENDING"),
    [loginRequests]
  );

  const handleApproveDeviceRequest = async (reqItem: AdminLoginRequestItem) => {
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await safeApiFetch<any>("/api/admin/login-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE",
          requestId: reqItem.id,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(
          res.data.message ||
            `Perangkat baru (${reqItem.device.deviceName}) untuk ${reqItem.user.email} berhasil diotorisasi. Sesi perangkat lama telah dicabut.`
        );
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal menyetujui perangkat baru.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat menyetujui perangkat baru.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectDeviceRequest = async (reqItem: AdminLoginRequestItem) => {
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await safeApiFetch<any>("/api/admin/login-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REJECT",
          requestId: reqItem.id,
          rejectionReason: "Permintaan login dari perangkat baru ditolak oleh Administrator.",
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(
          res.data.message ||
            `Permintaan login perangkat baru (${reqItem.device.deviceName}) untuk ${reqItem.user.email} ditolak. Perangkat lama tetap aktif.`
        );
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal menolak permintaan perangkat.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat menolak permintaan perangkat.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string, userEmail: string, deviceName: string) => {
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await safeApiFetch<any>("/api/admin/login-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVOKE_DEVICE",
          deviceId,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(
          res.data.message ||
            `Perangkat aktif (${deviceName}) milik ${userEmail} telah dicabut dan sesinya dihentikan.`
        );
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal mencabut perangkat aktif.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat mencabut perangkat.");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleRowPasswordVisibility = (userId: string) => {
    setVisiblePasswordMap((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  };

  const handleCopyPassword = async (userId: string, pwd: string) => {
    try {
      await navigator.clipboard.writeText(pwd);
      setCopiedUserId(userId);
      setTimeout(() => setCopiedUserId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const stats = useMemo(() => {
    const total = users.length;
    const pending = users.filter((u) => u.status === "PENDING").length;
    const active = users.filter((u) => u.status === "ACTIVE").length;
    const deactivated = users.filter((u) => u.status === "DEACTIVATED").length;
    const admins = users.filter((u) => u.role === "ADMIN").length;
    return { total, pending, active, deactivated, admins };
  }, [users]);

  const pendingUsers = useMemo(() => users.filter((u) => u.status === "PENDING"), [users]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter === "PENDING" && u.status !== "PENDING") return false;
      if (statusFilter === "ACTIVE" && u.status !== "ACTIVE") return false;
      if (statusFilter === "DEACTIVATED" && u.status !== "DEACTIVATED") return false;
      if (statusFilter === "ADMIN" && u.role !== "ADMIN") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchEmail = u.email.toLowerCase().includes(q);
        const matchName = (u.name || "").toLowerCase().includes(q);
        if (!matchEmail && !matchName) return false;
      }
      return true;
    });
  }, [users, statusFilter, searchQuery]);

  const handleSetUserStatus = async (
    targetUser: ManagedUser,
    nextStatus: "PENDING" | "ACTIVE" | "DEACTIVATED"
  ) => {
    if (targetUser.id === currentAdmin?.id && nextStatus !== "ACTIVE") {
      setErrorMessage("Anda tidak dapat menonaktifkan atau membatasi akun Admin Anda sendiri.");
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await safeApiFetch<any>("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUser.id,
          status: nextStatus,
        }),
      });
      if (res.ok && res.data?.success) {
        const statusLabel =
          nextStatus === "ACTIVE"
            ? "diotorisasi & diaktifkan (ACTIVE)"
            : nextStatus === "PENDING"
            ? "dikembalikan ke status Menunggu Otorisasi (PENDING)"
            : "dibatasi / dinonaktifkan (DEACTIVATED)";
        setSuccessMessage(`Akun ${targetUser.email} berhasil ${statusLabel}.`);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal memperbarui status pengguna.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat memperbarui status pengguna.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRole = async (targetUser: ManagedUser) => {
    if (targetUser.id === currentAdmin?.id) {
      setErrorMessage("Anda tidak dapat mencabut hak akses Admin Anda sendiri.");
      return;
    }

    const nextRole = targetUser.role === "ADMIN" ? "USER" : "ADMIN";
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await safeApiFetch<any>("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUser.id,
          role: nextRole,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`Role pengguna ${targetUser.email} diubah menjadi ${nextRole}.`);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal memperbarui role pengguna.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat memperbarui role.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newPassword) {
      setErrorMessage("Email dan password wajib diisi.");
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await safeApiFetch<any>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          name: newName || undefined,
          password: newPassword,
          role: newRole,
          status: newStatus,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`Pengguna baru ${newEmail} berhasil dibuat dengan status ${newStatus}.`);
        setShowCreateModal(false);
        setNewEmail("");
        setNewName("");
        setNewPassword("");
        setShowNewPassword(false);
        setNewRole("USER");
        setNewStatus("ACTIVE");
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal membuat pengguna.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat membuat pengguna.");
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (u: ManagedUser) => {
    setSelectedUserForEdit(u);
    setEditName(u.name || "");
    setEditEmail(u.email);
    setEditPassword(u.passwordPlain || "");
    setShowEditPassword(false);
    setEditRole(u.role);
    setEditStatus(u.status);
    setShowEditModal(true);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForEdit) return;

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: Record<string, unknown> = {
        userId: selectedUserForEdit.id,
        name: editName,
        email: editEmail,
        role: editRole,
        status: editStatus,
      };
      if (editPassword.trim() && editPassword !== (selectedUserForEdit.passwordPlain || "")) {
        payload.password = editPassword;
      }

      const res = await safeApiFetch<any>("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`Data & kredensial akun ${editEmail} berhasil diperbarui.`);
        setShowEditModal(false);
        setSelectedUserForEdit(null);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal memperbarui data pengguna.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat menyimpan perubahan pengguna.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUserForDelete) return;

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await safeApiFetch<any>("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserForDelete.id,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`Akun pengguna ${selectedUserForDelete.email} berhasil dihapus secara permanen.`);
        setShowDeleteModal(false);
        setSelectedUserForDelete(null);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal menghapus pengguna.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat menghapus akun pengguna.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForReset || !resetNewPassword) {
      setErrorMessage("Silakan masukkan password baru.");
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await safeApiFetch<any>("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserForReset.id,
          newPassword: resetNewPassword,
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`Password untuk ${selectedUserForReset.email} berhasil diperbarui.`);
        setShowResetModal(false);
        setSelectedUserForReset(null);
        setResetNewPassword("");
        setShowResetPasswordInput(false);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Gagal mereset password.");
      }
    } catch {
      setErrorMessage("Kesalahan jaringan saat mereset password.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Admin Console — Otorisasi, Kredensial &amp; Manajemen Akun Pengguna
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Otorisasi pendaftaran akun baru, lihat &amp; edit seluruh data maupun password pengguna, serta kelola hak akses (RBAC).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAllPasswords((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            {showAllPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showAllPasswords ? "Sembunyikan Semua Password" : "Tampilkan Semua Password"}</span>
          </button>

          <button
            type="button"
            onClick={fetchUsers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            id="admin-create-user-btn"
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Tambah Pengguna</span>
          </button>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Total Pengguna</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.total}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{stats.admins} Administrator</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs">
          <div className="flex items-center justify-between text-amber-700 text-xs font-medium mb-1">
            <span>Menunggu Otorisasi</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700">{stats.pending}</div>
          <div className="text-[11px] text-amber-600 mt-0.5">Butuh persetujuan Admin</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-medium mb-1">
            <span>Akun Aktif</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">{stats.active}</div>
          <div className="text-[11px] text-emerald-600 mt-0.5">Memiliki akses penuh</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-xs">
          <div className="flex items-center justify-between text-rose-700 text-xs font-medium mb-1">
            <span>Akses Dibatasi</span>
            <Ban className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-700">{stats.deactivated}</div>
          <div className="text-[11px] text-rose-600 mt-0.5">Dinonaktifkan / Diblokir</div>
        </div>
      </div>

      {/* Pending Device Login Requests Queue (ONE USER = ONE ACTIVE DEVICE) */}
      <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-5 space-y-3.5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#2563EB] flex items-center justify-center shrink-0">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  Otorisasi Perangkat &amp; Permintaan Login Perangkat Baru (
                  {pendingDeviceLoginRequests.length} Pending)
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-md">
                  1 Akun = 1 Perangkat Aktif
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Setujui (Approve) untuk mengalihkan perangkat aktif ke perangkat baru dan mencabut sesi perangkat lama, atau Tolak (Reject) untuk mempertahankan perangkat lama.
              </p>
            </div>
          </div>

          {historyDeviceLoginRequests.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDeviceHistory((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <History className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {showDeviceHistory
                  ? "Sembunyikan Riwayat Perangkat"
                  : `Riwayat Otorisasi (${historyDeviceLoginRequests.length})`}
              </span>
            </button>
          )}
        </div>

        {pendingDeviceLoginRequests.length === 0 ? (
          <div className="bg-white/90 rounded-xl border border-blue-100 px-4 py-3 text-xs text-slate-500 flex items-center justify-between">
            <span>Tidak ada permintaan login dari perangkat baru yang menunggu persetujuan saat ini.</span>
            <span className="text-[11px] text-emerald-700 font-semibold inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Semua perangkat terpantau aman
            </span>
          </div>
        ) : (
          <div className="divide-y divide-blue-100 bg-white rounded-xl border border-blue-200 overflow-hidden">
            {pendingDeviceLoginRequests.map((reqItem) => (
              <div
                key={reqItem.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {reqItem.user.name || "Unnamed User"}
                    </span>
                    <span className="text-[11px] font-mono text-slate-600">
                      ({reqItem.user.email})
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                      MENUNGGU PERSETUJUAN PERANGKAT BARU
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200/80">
                      <span className="text-[10px] font-bold uppercase text-blue-700 block">
                        Perangkat Baru (Meminta Login)
                      </span>
                      <span className="font-semibold text-slate-900 block mt-0.5">
                        {reqItem.device.deviceName}
                      </span>
                      <span className="text-slate-500">
                        Browser: {reqItem.device.browser} · OS: {reqItem.device.operatingSystem}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">
                        Perangkat Aktif Saat Ini (Akan Dicabut Jika Disetujui)
                      </span>
                      {reqItem.currentActiveDevice ? (
                        <>
                          <span className="font-semibold text-slate-800 block mt-0.5">
                            {reqItem.currentActiveDevice.deviceName}
                          </span>
                          <span className="text-slate-500">
                            Aktif terakhir:{" "}
                            {new Date(reqItem.currentActiveDevice.lastSeenAt).toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500 block mt-0.5">
                          Tidak ada perangkat aktif sebelumnya
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-3 pt-0.5">
                    <span>Diminta: {new Date(reqItem.requestedAt).toLocaleString()}</span>
                    <span>·</span>
                    <span>Kedaluwarsa: {new Date(reqItem.expiresAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleApproveDeviceRequest(reqItem)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve Perangkat Baru</span>
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleRejectDeviceRequest(reqItem)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent Device Authorization History */}
        {showDeviceHistory && historyDeviceLoginRequests.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-2">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700">
              Riwayat Permintaan Otorisasi Perangkat
            </div>
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto text-xs">
              {historyDeviceLoginRequests.slice(0, 15).map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{item.user.email}</span>{" "}
                    <span className="text-slate-500">— {item.device.deviceName}</span>
                    <div className="text-[10px] text-slate-400">
                      Diminta: {new Date(item.requestedAt).toLocaleString()}
                      {item.reviewedAt &&
                        ` · Ditinjau: ${new Date(item.reviewedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase self-start sm:self-center ${
                      item.status === "APPROVED"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : item.status === "REJECTED"
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pending Approval Queue Highlight Card */}
      {pendingUsers.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-5 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-amber-950">
                  Permintaan Otorisasi Registrasi Akun Baru ({pendingUsers.length})
                </h3>
                <p className="text-[11px] text-amber-800">
                  Pengguna di bawah ini telah mendaftar dan membutuhkan persetujuan Admin sebelum dapat login.
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-amber-200/70 bg-white rounded-xl border border-amber-200 overflow-hidden">
            {pendingUsers.map((pu) => (
              <div
                key={pu.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-bold text-slate-900">{pu.name || "Tanpa Nama"}</div>
                  <div className="text-[11px] font-mono text-slate-600">{pu.email}</div>
                  {pu.passwordPlain && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Password: <span className="font-mono font-semibold text-slate-800">{pu.passwordPlain}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Terdaftar: {new Date(pu.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleSetUserStatus(pu, "ACTIVE")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Setujui &amp; Otorisasi</span>
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleSetUserStatus(pu, "DEACTIVATED")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Tolak / Blokir</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "ALL", label: `Semua (${stats.total})` },
              { id: "PENDING", label: `Menunggu Otorisasi (${stats.pending})` },
              { id: "ACTIVE", label: `Aktif (${stats.active})` },
              { id: "DEACTIVATED", label: `Dibatasi (${stats.deactivated})` },
              { id: "ADMIN", label: `Admin (${stats.admins})` },
            ] as { id: StatusFilter; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau email..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* User Records Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Pengguna</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-4">Perangkat Aktif (1 Device)</th>
                <th className="py-3 px-4">Role Akses</th>
                <th className="py-3 px-4">Status Otorisasi</th>
                <th className="py-3 px-4">Dokumen / Ekspor</th>
                <th className="py-3 px-4 text-right">Kontrol Akses &amp; Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-500" />
                    Memuat data akun pengguna...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Tidak ada akun pengguna yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = u.id === currentAdmin?.id;
                  const isActive = u.status === "ACTIVE";
                  const isPending = u.status === "PENDING";
                  const isAdmin = u.role === "ADMIN";
                  const isPwdVisible = showAllPasswords || Boolean(visiblePasswordMap[u.id]);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">{u.name || "Unnamed"}</span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 rounded border border-blue-200">
                              Anda
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 font-mono text-[11px]">{u.email}</div>
                      </td>

                      {/* Password Column */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.passwordPlain ? (
                          <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                            <span className="font-mono text-[11px] text-slate-800 select-all">
                              {isPwdVisible ? u.passwordPlain : "••••••••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleRowPasswordVisibility(u.id)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                              title={isPwdVisible ? "Sembunyikan password" : "Lihat password"}
                            >
                              {isPwdVisible ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyPassword(u.id, u.passwordPlain!)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                              title="Salin password"
                            >
                              {copiedUserId === u.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                            title="Klik untuk mengatur password baru agar dapat dilihat"
                          >
                            <Key className="w-3 h-3" />
                            <span>Atur / Edit Password</span>
                          </button>
                        )}
                      </td>

                      {/* Active Device Column */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.activeDevice ? (
                          <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                            <div>
                              <div className="font-semibold text-[11px] text-slate-800 flex items-center gap-1">
                                <Laptop className="w-3 h-3 text-emerald-600 shrink-0" />
                                <span>{u.activeDevice.deviceName}</span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Aktif: {new Date(u.activeDevice.lastSeenAt).toLocaleDateString()}
                              </div>
                            </div>
                            {!isCurrent && (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                  handleRevokeDevice(
                                    u.activeDevice!.id,
                                    u.email,
                                    u.activeDevice!.deviceName
                                  )
                                }
                                className="px-2 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors cursor-pointer"
                                title="Cabut perangkat aktif & hentikan sesi"
                              >
                                Cabut
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            Belum ada perangkat aktif
                          </span>
                        )}
                        {(u.pendingDeviceRequests ?? 0) > 0 && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              <Clock className="w-2.5 h-2.5" />
                              {u.pendingDeviceRequests} perangkat baru menunggu
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleRole(u)}
                          disabled={actionLoading || isCurrent}
                          title={isCurrent ? "Tidak dapat mengubah role sendiri" : "Klik untuk mengubah role USER/ADMIN"}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                            isAdmin
                              ? "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                              : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                          }`}
                        >
                          {isAdmin ? (
                            <>
                              <ShieldAlert className="w-3 h-3 text-purple-600" />
                              ADMIN
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 text-slate-500" />
                              USER
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold border ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : isPending
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                        >
                          {isActive
                            ? "ACTIVE (Diotorisasi)"
                            : isPending
                            ? "PENDING (Butuh Otorisasi)"
                            : "DEACTIVATED (Akses Dibatasi)"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-700 whitespace-nowrap">
                        {u.documentCount} dok · {u.exportCount} xlsx
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {isPending && (
                            <button
                              type="button"
                              onClick={() => handleSetUserStatus(u, "ACTIVE")}
                              disabled={actionLoading}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                              title="Setujui & Otorisasi Akun"
                            >
                              Otorisasi
                            </button>
                          )}

                          {!isPending && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSetUserStatus(u, isActive ? "DEACTIVATED" : "ACTIVE")
                              }
                              disabled={actionLoading || isCurrent}
                              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isActive
                                  ? "text-rose-700 border-rose-200 bg-rose-50/60 hover:bg-rose-100"
                                  : "text-emerald-700 border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100"
                              }`}
                            >
                              {isActive ? "Batasi Akses" : "Aktifkan"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium transition-colors cursor-pointer"
                            title="Edit Data, Password & Hak Akses Pengguna"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUserForReset(u);
                              setResetNewPassword(u.passwordPlain || "");
                              setShowResetPasswordInput(false);
                              setShowResetModal(true);
                            }}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Ganti / Reset Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={actionLoading || isCurrent}
                            onClick={() => {
                              setSelectedUserForDelete(u);
                              setShowDeleteModal(true);
                            }}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Hapus Akun Pengguna"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 max-w-md w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Tambah Akun Pengguna Baru</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alamat Email *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 8 karakter (huruf + angka/simbol)"
                    className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showNewPassword ? "Sembunyikan password" : "Tampilkan password"}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as "USER" | "ADMIN")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="USER">Standard User (USER)</option>
                    <option value="ADMIN">Administrator (ADMIN)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Awal</label>
                  <select
                    value={newStatus}
                    onChange={(e) =>
                      setNewStatus(e.target.value as "ACTIVE" | "PENDING" | "DEACTIVATED")
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="ACTIVE">ACTIVE (Langsung Aktif)</option>
                    <option value="PENDING">PENDING (Menunggu Otorisasi)</option>
                    <option value="DEACTIVATED">DEACTIVATED (Dibatasi)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {actionLoading ? "Menyimpan..." : "Buat Akun"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Data & Password Modal */}
      {showEditModal && selectedUserForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 max-w-md w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Edit Data, Password &amp; Hak Akses Pengguna
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedUserForEdit(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditUser} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nama pengguna"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alamat Email</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Pengguna{" "}
                  <span className="font-normal text-slate-400">
                    (Ubah untuk mengganti password)
                  </span>
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? "text" : "password"}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Masukkan password baru (min. 8 karakter + angka/simbol)"
                    className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showEditPassword ? "Sembunyikan password" : "Tampilkan password"}
                  >
                    {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role Hak Akses</label>
                  <select
                    value={editRole}
                    disabled={selectedUserForEdit.id === currentAdmin?.id}
                    onChange={(e) => setEditRole(e.target.value as "USER" | "ADMIN")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:opacity-50"
                  >
                    <option value="USER">USER (Pengguna Standar)</option>
                    <option value="ADMIN">ADMIN (Administrator)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Otorisasi</label>
                  <select
                    value={editStatus}
                    disabled={selectedUserForEdit.id === currentAdmin?.id}
                    onChange={(e) =>
                      setEditStatus(e.target.value as "PENDING" | "ACTIVE" | "DEACTIVATED")
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:opacity-50"
                  >
                    <option value="ACTIVE">ACTIVE (Diizinkan)</option>
                    <option value="PENDING">PENDING (Menunggu Otorisasi)</option>
                    <option value="DEACTIVATED">DEACTIVATED (Dibatasi)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedUserForEdit(null);
                  }}
                  className="px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {actionLoading ? "Menyimpan..." : "Simpan Perubahan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUserForReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 max-w-md w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Ubah / Reset Password: {selectedUserForReset.email}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setSelectedUserForReset(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password Baru *</label>
                <div className="relative">
                  <input
                    type={showResetPasswordInput ? "text" : "password"}
                    required
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    placeholder="Minimal 8 karakter (huruf + angka/simbol)"
                    className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPasswordInput((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showResetPasswordInput ? "Sembunyikan password" : "Tampilkan password"}
                  >
                    {showResetPasswordInput ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetModal(false);
                    setSelectedUserForReset(null);
                  }}
                  className="px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {actionLoading ? "Menyimpan..." : "Simpan Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {showDeleteModal && selectedUserForDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 max-w-md w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-rose-700">Hapus Akun Pengguna</h3>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedUserForDelete(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 leading-relaxed space-y-2">
              <p>
                Apakah Anda yakin ingin menghapus akun{" "}
                <span className="font-bold text-slate-900">{selectedUserForDelete.email}</span> secara permanen?
              </p>
              <p className="text-rose-600 font-medium">
                Seluruh sesi aktif, dokumen, dan riwayat ekspor milik pengguna ini juga akan dihapus.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedUserForDelete(null);
                }}
                className="px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={actionLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
              >
                {actionLoading ? "Menghapus..." : "Ya, Hapus Permanen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
