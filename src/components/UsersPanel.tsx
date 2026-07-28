import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usersRepository, roleTemplatesRepository } from "@/repositories";
import { useAuth } from "@/auth/AuthContext";
import { ROLE_LABELS, PERMISSION_LABELS } from "@/lib/permissions";
import { PageHeader } from "./PageHeader";
import type { Permissions, UserRole } from "@/types/models";

const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof Permissions)[];
const ALL_ROLES: readonly UserRole[] = ["admin", "standard", "viewer"];

export function UsersPanel({ view = "both" }: { view?: "list" | "profile" | "both" }) {
  const { currentUser, refresh } = useAuth();
  const users = useLiveQuery(() => usersRepository.list(), []);
  const roleTemplates = useLiveQuery(() => roleTemplatesRepository.list(), []);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("standard");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<{
    username: string;
    code: string;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPermissions, setEditPermissions] = useState<Permissions | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [regenerateId, setRegenerateId] = useState<string | null>(null);
  const [regeneratePasswordValue, setRegeneratePasswordValue] = useState("");
  const [regeneratedCode, setRegeneratedCode] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const pageTitle = view === "profile" ? "Profil" : "Utilisateurs";

  if (!currentUser?.permissions.manageUsers) {
    return (
      <section aria-labelledby="users-heading">
        <PageHeader title={pageTitle} section="users" id="users-heading" />
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de gérer les utilisateurs.
        </p>
      </section>
    );
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    try {
      const { recoveryCode } = await usersRepository.create({
        username,
        displayName,
        password,
        role,
      });
      setCreatedRecoveryCode({ username, code: recoveryCode });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("standard");
      setShowCreateForm(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleRegenerateRecoveryCode(id: string) {
    setRowError(null);
    try {
      const newCode = await usersRepository.regenerateRecoveryCode(id, regeneratePasswordValue);
      setRegeneratedCode(newCode);
      setRegenerateId(null);
      setRegeneratePasswordValue("");
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  function startEditingPermissions(id: string, permissions: Permissions) {
    setEditingId(id);
    setEditPermissions({ ...permissions });
    setRowError(null);
  }

  async function saveEditedPermissions(id: string) {
    if (!editPermissions) return;
    try {
      await usersRepository.update(id, { permissions: editPermissions });
      setEditingId(null);
      setEditPermissions(null);
      await refresh();
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleRoleChange(id: string, newRole: UserRole) {
    setRowError(null);
    try {
      await usersRepository.update(id, { role: newRole });
      await refresh();
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Voulez-vous vraiment supprimer cet utilisateur ? Il perdra tout accès à l'application. Cette action est irréversible.",
      )
    ) {
      return;
    }
    setRowError(null);
    try {
      await usersRepository.remove(id);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleResetPassword(id: string) {
    setRowError(null);
    try {
      await usersRepository.adminResetPassword(id, resetPasswordValue);
      setResetPasswordId(null);
      setResetPasswordValue("");
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleTogglePrivilege(roleId: UserRole, key: keyof Permissions, permit: boolean) {
    setTemplateError(null);
    const current = roleTemplates?.find((t) => t.id === roleId);
    if (!current) return;
    try {
      await roleTemplatesRepository.update(roleId, {
        permissions: { ...current.permissions, [key]: permit },
      });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  const templateByRole = new Map((roleTemplates ?? []).map((t) => [t.id, t]));

  return (
    <section aria-labelledby="users-heading">
      <PageHeader title={pageTitle} section="users" id="users-heading" />

      {(view === "list" || view === "both") && (
        <>
          <p className="tagline">
            Chaque utilisateur a un rôle (point de départ) et des privilèges individuellement
            modifiables ensuite.
          </p>

          <button type="button" onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? "Annuler" : "+ Nouveau"}
          </button>

          {showCreateForm && (
            <form onSubmit={handleCreate} aria-label="Ajouter un utilisateur">
              <div className="field">
                <label htmlFor="user-username">Nom d&apos;utilisateur</label>
                <input
                  id="user-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="user-display-name">Nom affiché</label>
                <input
                  id="user-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="user-password">Mot de passe</label>
                <input
                  type="password"
                  id="user-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="user-role">Rôle</label>
                <select
                  id="user-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit">Créer</button>
              {createError && (
                <p role="alert" className="form-error">
                  {createError}
                </p>
              )}
            </form>
          )}

          {createdRecoveryCode && (
            <div className="note-box" role="status">
              <p>
                Code de récupération pour <strong>{createdRecoveryCode.username}</strong> —
                transmettez-le immédiatement à cette personne, il ne sera plus jamais affiché :
              </p>
              <p className="recovery-code">{createdRecoveryCode.code}</p>
              <button type="button" onClick={() => setCreatedRecoveryCode(null)}>
                J&apos;ai transmis ce code
              </button>
            </div>
          )}

          {regeneratedCode && (
            <div className="note-box" role="status">
              <p>
                Nouveau code de récupération — notez-le immédiatement, il ne sera plus jamais
                affiché :
              </p>
              <p className="recovery-code">{regeneratedCode}</p>
              <button type="button" onClick={() => setRegeneratedCode(null)}>
                Je l&apos;ai noté
              </button>
            </div>
          )}

          {users === undefined ? (
            <p>Chargement…</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Rôle</th>
                    <th>Privilèges</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        {user.displayName} <span className="empty">({user.username})</span>
                        {user.id === currentUser.id && <span className="empty"> — vous</span>}
                      </td>
                      <td>
                        <select
                          aria-label={`Rôle de ${user.displayName}`}
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                        >
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {editingId === user.id && editPermissions ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {PERMISSION_KEYS.map((key) => (
                              <label key={key} style={{ fontSize: ".8rem" }}>
                                <input
                                  type="checkbox"
                                  checked={editPermissions[key]}
                                  onChange={(e) =>
                                    setEditPermissions({
                                      ...editPermissions,
                                      [key]: e.target.checked,
                                    })
                                  }
                                />{" "}
                                {PERMISSION_LABELS[key]}
                              </label>
                            ))}
                            <div>
                              <button type="button" onClick={() => saveEditedPermissions(user.id)}>
                                Enregistrer
                              </button>{" "}
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditPermissions(null);
                                }}
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditingPermissions(user.id, user.permissions)}
                          >
                            Modifier les privilèges
                          </button>
                        )}
                      </td>
                      <td>
                        {resetPasswordId === user.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="password"
                              aria-label={`Nouveau mot de passe pour ${user.displayName}`}
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              style={{ width: 120 }}
                            />
                            <button type="button" onClick={() => handleResetPassword(user.id)}>
                              Confirmer
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setResetPasswordId(user.id);
                              setResetPasswordValue("");
                            }}
                          >
                            Réinitialiser le mot de passe
                          </button>
                        )}{" "}
                        {user.id === currentUser.id &&
                          (regenerateId === user.id ? (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="password"
                                aria-label="Mot de passe actuel pour régénérer le code"
                                value={regeneratePasswordValue}
                                onChange={(e) => setRegeneratePasswordValue(e.target.value)}
                                style={{ width: 120 }}
                              />
                              <button
                                type="button"
                                onClick={() => handleRegenerateRecoveryCode(user.id)}
                              >
                                Confirmer
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setRegenerateId(user.id);
                                setRegeneratePasswordValue("");
                              }}
                            >
                              Régénérer mon code de récupération
                            </button>
                          ))}{" "}
                        {user.id !== currentUser.id && (
                          <button type="button" onClick={() => handleDelete(user.id)}>
                            Supprimer
                          </button>
                        )}
                        {rowError?.id === user.id && (
                          <p role="alert" className="form-error">
                            {rowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {(view === "profile" || view === "both") && (
        <section className="accent-ink" aria-labelledby="profiles-heading">
          <h3 id="profiles-heading">Profils</h3>
          <p className="tagline">
            Chaque case autorise (Permit) ou refuse (Deny) un privilège pour ce rôle — le point de
            départ de tout nouvel utilisateur créé avec ce rôle. Modifier un profil ne change rien
            aux utilisateurs déjà créés.
          </p>
          {roleTemplates === undefined ? (
            <p>Chargement…</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Privilège</th>
                    {ALL_ROLES.map((r) => (
                      <th key={r}>{ROLE_LABELS[r]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_KEYS.map((key) => (
                    <tr key={key}>
                      <td>{PERMISSION_LABELS[key]}</td>
                      {ALL_ROLES.map((r) => {
                        const template = templateByRole.get(r);
                        const permitted = template?.permissions[key] ?? false;
                        return (
                          <td key={r}>
                            <label>
                              <input
                                type="checkbox"
                                aria-label={`${PERMISSION_LABELS[key]} — ${ROLE_LABELS[r]}`}
                                checked={permitted}
                                onChange={(e) => handleTogglePrivilege(r, key, e.target.checked)}
                              />{" "}
                              {permitted ? "Permit" : "Deny"}
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {templateError && (
            <p role="alert" className="form-error">
              {templateError}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
