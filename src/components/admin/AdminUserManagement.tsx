import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { safeApiFetch } from "../../lib/api-client";
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Mail,
  User,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Loader2,
  Key,
} from "lucide-react";

interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DEACTIVATED";
  createdAt: string;
  documentCount: number;
  exportCount: number;
}

export const AdminUserManagement: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUserForReset, setSelectedUserForReset] = useState<ManagedUser | null>(null);

  // New user form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"USER" | "ADMIN">("USER");

  // Reset password form state
  const [resetNewPassword, setResetNewPassword] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await safeApiFetch<{ success: boolean; users: ManagedUser[]; error?: string }>("/api/admin/users");
      if (res.ok && res.data?.success) {
        setUsers(res.data.users);
      } else {
        setErrorMessage(res.error || res.data?.error || "Failed to load user records.");
      }
    } catch {
      setErrorMessage("Network error loading users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleStatus = async (targetUser: ManagedUser) => {
    if (targetUser.id === currentAdmin?.id) {
      setErrorMessage("You cannot deactivate your own administrative account.");
      return;
    }

    const nextStatus = targetUser.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
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
        setSuccessMessage(`User account successfully ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}.`);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Failed to update user status.");
      }
    } catch {
      setErrorMessage("Network error updating user status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRole = async (targetUser: ManagedUser) => {
    if (targetUser.id === currentAdmin?.id) {
      setErrorMessage("You cannot remove your own administrative privileges.");
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
        setSuccessMessage(`User role changed to ${nextRole}.`);
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Failed to update user role.");
      }
    } catch {
      setErrorMessage("Network error updating role.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newPassword) {
      setErrorMessage("Email and password are required.");
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
        }),
      });
      if (res.ok && res.data?.success) {
        setSuccessMessage(`New user ${newEmail} created successfully.`);
        setShowCreateModal(false);
        setNewEmail("");
        setNewName("");
        setNewPassword("");
        setNewRole("USER");
        await fetchUsers();
      } else {
        setErrorMessage(res.error || res.data?.error || "Failed to create user.");
      }
    } catch {
      setErrorMessage("Network error creating user.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForReset || !resetNewPassword) {
      setErrorMessage("Please provide a new password.");
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
        setSuccessMessage(`Password reset for ${selectedUserForReset.email}.`);
        setShowResetModal(false);
        setSelectedUserForReset(null);
        setResetNewPassword("");
      } else {
        setErrorMessage(res.error || res.data?.error || "Failed to reset password.");
      }
    } catch {
      setErrorMessage("Network error resetting password.");
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
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Admin Console & User RBAC</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage system users, administrative permissions, and tenant isolation in Neon PostgreSQL.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            <span>Create User</span>
          </button>
        </div>
      </div>

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

      {/* User Records Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Documents</th>
                <th className="py-3 px-4">Exports</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-500" />
                    Loading user records...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No users found in database.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isCurrent = u.id === currentAdmin?.id;
                  const isActive = u.status === "ACTIVE";
                  const isAdmin = u.role === "ADMIN";

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.name || "Unnamed"}</div>
                        <div className="text-slate-500 font-mono text-[11px]">{u.email}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleRole(u)}
                          disabled={actionLoading || isCurrent}
                          title={isCurrent ? "Cannot change own role" : "Click to toggle role"}
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
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                        >
                          {isActive ? "ACTIVE" : "DEACTIVATED"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-700">
                        {u.documentCount}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-700">
                        {u.exportCount}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUserForReset(u);
                              setShowResetModal(true);
                            }}
                            className="px-2 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded text-xs transition-colors cursor-pointer"
                            title="Reset Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(u)}
                            disabled={actionLoading || isCurrent}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              isActive
                                ? "text-rose-600 hover:bg-rose-50"
                                : "text-emerald-600 hover:bg-emerald-50"
                            }`}
                          >
                            {isActive ? "Deactivate" : "Activate"}
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
              <h3 className="text-base font-bold text-slate-900">Create New System User</h3>
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
                <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "USER" | "ADMIN")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value="USER">Standard User (USER)</option>
                  <option value="ADMIN">Administrative User (ADMIN)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {actionLoading ? "Creating..." : "Create User"}
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
                Reset Password: {selectedUserForReset.email}
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
                <label className="block font-semibold text-slate-700 mb-1">New Password *</label>
                <input
                  type="password"
                  required
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Enter new secure password"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
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
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {actionLoading ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
