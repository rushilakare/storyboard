'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import AnimatedCharactersLoginPage from '@/components/ui/animated-characters-login-page';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/workspaces';

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<
    string | null
  >(null);
  const [signInAfterConfirmHint, setSignInAfterConfirmHint] = useState(false);

  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendFeedback, setResendFeedback] = useState<
    { type: 'ok' | 'err'; text: string } | null
  >(null);

  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

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

  function handleModeChange(next: 'signin' | 'signup') {
    setMode(next);
    setError(null);
    if (next === 'signup') {
      setSignInAfterConfirmHint(false);
    }
  }

  function handleForgotPassword() {
    setForgotEmail(email);
    setForgotError(null);
    setForgotSent(false);
    setMode('forgot');
  }

  function handleBackToSignIn() {
    setMode('signin');
    setForgotError(null);
    setForgotSent(false);
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const origin = window.location.origin;
      const { error: err } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${origin}/auth/reset-callback`,
      });
      if (err) {
        setForgotError(err.message);
        return;
      }
      setForgotSent(true);
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    const supabase = createBrowserSupabaseClient();
    const origin = window.location.origin;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback`,
      },
    });
    if (err) {
      setError(err.message);
    }
  }

  const showCheckEmail = pendingConfirmationEmail !== null;

  return (
    <AnimatedCharactersLoginPage
      mode={mode}
      onModeChange={handleModeChange}
      email={email}
      onEmailChange={setEmail}
      password={password}
      onPasswordChange={setPassword}
      error={error}
      loading={loading}
      onSubmit={onSubmit}
      signInAfterConfirmHint={signInAfterConfirmHint}
      showCheckEmail={showCheckEmail}
      pendingConfirmationEmail={pendingConfirmationEmail}
      onContinueToSignIn={handleContinueToSignIn}
      onResendConfirmation={handleResend}
      resendSeconds={resendSeconds}
      resendFeedback={resendFeedback}
      onGoogleLogin={handleGoogleLogin}
      onForgotPassword={handleForgotPassword}
      forgotEmail={forgotEmail}
      onForgotEmailChange={setForgotEmail}
      onForgotSubmit={handleForgotSubmit}
      forgotLoading={forgotLoading}
      forgotError={forgotError}
      forgotSent={forgotSent}
      onBackToSignIn={handleBackToSignIn}
    />
  );
}
