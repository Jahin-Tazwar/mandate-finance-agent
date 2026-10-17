import { useEffect, useState } from "react";
import type { DemoAccount, Persona } from "@mandate/shared";
import { apiLogin, apiLogout, fetchDemoAccounts } from "./lib/api";

interface PersonaSwitcherModalProps {
  currentPersona: Persona;
  isOpen: boolean;
  onClose: () => void;
  onPersonaSwitched: (newPersona: Persona) => void;
  onSignOut: () => void;
}

export function PersonaSwitcherModal({
  currentPersona,
  isOpen,
  onClose,
  onPersonaSwitched,
  onSignOut,
}: PersonaSwitcherModalProps) {
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchDemoAccounts()
        .then(setDemoAccounts)
        .catch(() => {
          // fallback
          setDemoAccounts([
            { personaId: "maya", name: "Maya Chen", profile: "International student, part-time cafe job", username: "maya", password: "maya-demo", pin: "1111" },
            { personaId: "daniel", name: "Daniel Okafor", profile: "Young professional, many subscriptions", username: "daniel", password: "daniel-demo", pin: "2222" },
            { personaId: "aisha", name: "Aisha Rahman", profile: "Gig worker with daily payouts", username: "aisha", password: "aisha-demo", pin: "3333" },
          ]);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSwitch = async (account: DemoAccount) => {
    if (account.personaId === currentPersona.id) return;
    setSwitchingTo(account.personaId);
    try {
      await apiLogout();
      const newPersona = await apiLogin(account.username, account.password);
      onPersonaSwitched(newPersona);
      onClose();
    } catch (err) {
      console.error("Failed to switch persona", err);
    } finally {
      setSwitchingTo(null);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await apiLogout();
      onSignOut();
      onClose();
    } catch (err) {
      console.error("Failed to sign out", err);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="switcher-modal-title">
      <div className="modal-dialog switcher-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">DEMO PERSONA SWITCHER</span>
            <h2 id="switcher-modal-title" className="modal-title">Switch Demo Account</h2>
          </div>
          <button className="icon-button modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <p className="switcher-description">
          Each persona has distinct income patterns, recurring bills, and savings goals. Switching will sign you into the selected profile.
        </p>

        <div className="switcher-list">
          {demoAccounts.map((account) => {
            const isCurrent = account.personaId === currentPersona.id;
            const isSwitchingThis = switchingTo === account.personaId;
            const initials = account.name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2);

            return (
              <div
                key={account.personaId}
                className={`switcher-item ${isCurrent ? "active-persona" : ""}`}
              >
                <div className="switcher-item-left">
                  <span className="avatar switcher-avatar">{initials}</span>
                  <div className="switcher-info">
                    <div className="switcher-name-row">
                      <strong className="switcher-name">{account.name}</strong>
                      {isCurrent && <span className="current-badge">Active</span>}
                    </div>
                    <span className="switcher-profile">{account.profile}</span>
                    <span className="switcher-pin-hint">PIN: {account.pin}</span>
                  </div>
                </div>

                <div className="switcher-item-right">
                  {isCurrent ? (
                    <span className="active-indicator-text">Signed In</span>
                  ) : (
                    <button
                      type="button"
                      className="button button-primary switcher-btn"
                      disabled={Boolean(switchingTo) || signingOut}
                      onClick={() => handleSwitch(account)}
                    >
                      {isSwitchingThis ? (
                        <>
                          <span className="spinner" />
                          <span>Switching…</span>
                        </>
                      ) : (
                        <span>Switch</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-footer switcher-footer">
          <button
            type="button"
            className="button button-secondary signout-btn"
            disabled={Boolean(switchingTo) || signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
