"use client";

import * as React from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { profileApi } from "@/lib/profile";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

type ProfileSectionProps = {
  user: SessionUser | null;
  refreshSession: () => Promise<void>;
};

const inputClass =
  "mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <span className="relative mt-1.5 block">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className={`${inputClass} pr-11`}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition hover:text-brand-teal"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

export function ProfileSection({ user, refreshSession }: ProfileSectionProps) {
  const [fullName, setFullName] = React.useState(user?.full_name ?? "");
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [profileBusy, setProfileBusy] = React.useState(false);
  const [passwordBusy, setPasswordBusy] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [profileNotice, setProfileNotice] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  React.useEffect(() => {
    setFullName(user?.full_name ?? "");
    setEmail(user?.email ?? "");
  }, [user?.email, user?.full_name]);

  const saveDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();

    setProfileError(null);
    setProfileNotice(null);

    if (!trimmedName) {
      setProfileError("Full name is required.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setProfileError("Enter a valid email address.");
      return;
    }
    if (
      trimmedName === (user?.full_name ?? "").trim() &&
      trimmedEmail.toLowerCase() === (user?.email ?? "").trim().toLowerCase()
    ) {
      setProfileNotice("No account details have changed.");
      return;
    }

    setProfileBusy(true);
    try {
      await profileApi.update({ full_name: trimmedName, email: trimmedEmail });
      await refreshSession();
      setProfileNotice("Account details saved.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save account details.";
      setProfileError(
        message === "email already in use"
          ? "That email is already used by another VoltRide account."
          : message
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);

    if (newPassword.length < 8) {
      setPasswordError("New password must contain at least 8 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Your new password must be different from your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setPasswordBusy(true);
    try {
      await profileApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password changed successfully.");
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "Unable to change password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">My Profile</h2>
        <p className="mt-1 text-xs text-muted">Manage your VoltRide account details and password.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-full bg-brand-teal/10 p-3 text-brand-teal">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-ink">Account details</h3>
              <p className="text-sm text-muted">Update the name and email shown on your account.</p>
            </div>
          </div>

          {profileError && <Alert variant="danger" className="mb-4">{profileError}</Alert>}
          {profileNotice && <Alert variant="success" className="mb-4">{profileNotice}</Alert>}

          <form onSubmit={saveDetails} className="space-y-4">
            <label className="block text-sm font-medium text-ink">
              Full Name
              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                className={inputClass}
                required
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className={inputClass}
                required
              />
            </label>
            <div className="rounded-xl bg-card px-4 py-3 text-sm">
              <p className="text-muted">Login phone</p>
              <p className="mt-1 font-medium text-ink">{user?.phone ?? "—"}</p>
            </div>
            <Button type="submit" disabled={profileBusy}>
              {profileBusy ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-full bg-brand/10 p-3 text-brand">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-ink">Change password</h3>
              <p className="text-sm text-muted">Confirm your current password before choosing a new one.</p>
            </div>
          </div>

          {passwordError && <Alert variant="danger" className="mb-4">{passwordError}</Alert>}
          {passwordNotice && <Alert variant="success" className="mb-4">{passwordNotice}</Alert>}

          <form onSubmit={changePassword} className="space-y-4">
            <PasswordInput label="Current Password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <PasswordInput label="New Password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            <PasswordInput label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
            <p className="text-xs text-muted">Use at least 8 characters and a password different from your current one.</p>
            <Button type="submit" disabled={passwordBusy}>
              {passwordBusy ? "Changing…" : "Change password"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}