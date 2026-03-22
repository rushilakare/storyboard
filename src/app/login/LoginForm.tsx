'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import styles from './login.module.css';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/workspaces';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** When set, show check-email panel instead of the form (Supabase returned no session after sign-up). */
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<
    string | null
  >(null);
  const [signInAfterConfirmHint, setSignInAfterConfirmHint] = useState(false);

  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendFeedback, setResendFeedback] = useState<
    { type: 'ok' | 'err'; text: string } | null
  >(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = setInterval(() => setResendSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendSeconds]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
        });
        if (err) {
          setError(err.message);
          return;
        }
        if (data.session) {
          router.refresh();
          router.push(nextPath.startsWith('/') ? nextPath : '/workspaces');
          return;
        }
        setPendingConfirmationEmail(email);
        setPassword('');
        setSignInAfterConfirmHint(false);
        setResendFeedback(null);
        setResendSeconds(0);
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.refresh();
      router.push(nextPath.startsWith('/') ? nextPath : '/workspaces');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!pendingConfirmationEmail || resendSeconds > 0) return;
    setResendFeedback(null);
    const supabase = createBrowserSupabaseClient();
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: pendingConfirmationEmail,
    });
    if (err) {
      setResendFeedback({ type: 'err', text: err.message });
      return;
    }
    setResendFeedback({ type: 'ok', text: 'Confirmation email sent.' });
    setResendSeconds(60);
  }

  function handleContinueToSignIn() {
    setPendingConfirmationEmail(null);
    setMode('signin');
    setPassword('');
    setSignInAfterConfirmHint(true);
    setResendFeedback(null);
    setResendSeconds(0);
  }

  const showCheckEmail = pendingConfirmationEmail !== null;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Rushi PM
        </div>

        {showCheckEmail ? (
          <>
            <h1 className={styles.title}>Check your email</h1>
            <div
              className={styles.confirmPanel}
              role="status"
              aria-live="polite"
            >
              <p className={styles.confirmLead}>
                Confirm your email before signing in. We sent a link to{' '}
                <strong className={styles.confirmEmail}>
                  {pendingConfirmationEmail}
                </strong>
                .
              </p>
              <p className={styles.confirmHint}>
                Didn&apos;t get it? Check spam or promotions.
              </p>
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.submit}
                onClick={handleContinueToSignIn}
              >
                Continue to sign in
              </button>
              <button
                type="button"
                className={styles.resendBtn}
                onClick={handleResend}
                disabled={resendSeconds > 0}
              >
                {resendSeconds > 0
                  ? `Resend email (${resendSeconds}s)`
                  : 'Resend confirmation email'}
              </button>
              {resendFeedback ? (
                <p
                  className={
                    resendFeedback.type === 'ok' ? styles.resendOk : styles.error
                  }
                >
                  {resendFeedback.text}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.title}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h1>
            <p className={styles.sub}>
              Use the email and password you configured in Supabase Auth.
            </p>

            {signInAfterConfirmHint ? (
              <p
                className={styles.successBanner}
                role="status"
                aria-live="polite"
              >
                After you confirm your email, sign in below.
              </p>
            ) : null}

            <form className={styles.form} onSubmit={onSubmit}>
              <label className={styles.label}>
                Email
                <input
                  className={styles.input}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                Password
                <input
                  className={styles.input}
                  type="password"
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>
              {error ? <p className={styles.error}>{error}</p> : null}
              <button className={styles.submit} type="submit" disabled={loading}>
                {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
              </button>
            </form>

            <p className={styles.toggle}>
              {mode === 'signin' ? (
                <>
                  No account?{' '}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      setMode('signup');
                      setError(null);
                      setSignInAfterConfirmHint(false);
                    }}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                    }}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
