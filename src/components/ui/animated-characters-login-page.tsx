'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, Mail, Sparkles } from 'lucide-react';

export type AnimatedCharactersLoginPageProps = {
  mode: 'signin' | 'signup';
  onModeChange: (mode: 'signin' | 'signup') => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  error: string | null;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  signInAfterConfirmHint: boolean;
  showCheckEmail: boolean;
  pendingConfirmationEmail: string | null;
  onContinueToSignIn: () => void;
  onResendConfirmation: () => void;
  resendSeconds: number;
  resendFeedback: { type: 'ok' | 'err'; text: string } | null;
  onGoogleLogin?: () => void;
};

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
  eyesClosed?: boolean;
}

const Pupil = ({
  size = 12,
  maxDistance = 5,
  pupilColor = 'black',
  forceLookX,
  forceLookY,
  eyesClosed = false,
}: PupilProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const pupilRef = useRef<HTMLDivElement>(null);
  const [pupilPosition, setPupilPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  useEffect(() => {
    if (eyesClosed) return;
    const id = requestAnimationFrame(() => {
      const el = pupilRef.current;
      if (!el) return;

      if (forceLookX !== undefined && forceLookY !== undefined) {
        setPupilPosition({ x: forceLookX, y: forceLookY });
        return;
      }

      const pupil = el.getBoundingClientRect();
      const pupilCenterX = pupil.left + pupil.width / 2;
      const pupilCenterY = pupil.top + pupil.height / 2;

      const deltaX = mouseX - pupilCenterX;
      const deltaY = mouseY - pupilCenterY;
      const distance = Math.min(
        Math.sqrt(deltaX ** 2 + deltaY ** 2),
        maxDistance,
      );

      const angle = Math.atan2(deltaY, deltaX);
      setPupilPosition({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [
    mouseX,
    mouseY,
    maxDistance,
    forceLookX,
    forceLookY,
    eyesClosed,
  ]);

  if (eyesClosed) {
    return (
      <div
        className="rounded-full bg-[#2D2D2D]"
        style={{
          width: `${Math.max(size * 1.3, 14)}px`,
          height: '3px',
        }}
      />
    );
  }

  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    />
  );
};

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  eyesClosed?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall = ({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = 'white',
  pupilColor = 'black',
  isBlinking = false,
  eyesClosed = false,
  forceLookX,
  forceLookY,
}: EyeBallProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const eyeRef = useRef<HTMLDivElement>(null);
  const [pupilPosition, setPupilPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  useEffect(() => {
    if (isBlinking || eyesClosed) return;
    const id = requestAnimationFrame(() => {
      const el = eyeRef.current;
      if (!el) return;

      if (forceLookX !== undefined && forceLookY !== undefined) {
        setPupilPosition({ x: forceLookX, y: forceLookY });
        return;
      }

      const eye = el.getBoundingClientRect();
      const eyeCenterX = eye.left + eye.width / 2;
      const eyeCenterY = eye.top + eye.height / 2;

      const deltaX = mouseX - eyeCenterX;
      const deltaY = mouseY - eyeCenterY;
      const distance = Math.min(
        Math.sqrt(deltaX ** 2 + deltaY ** 2),
        maxDistance,
      );

      const angle = Math.atan2(deltaY, deltaX);
      setPupilPosition({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [
    mouseX,
    mouseY,
    maxDistance,
    forceLookX,
    forceLookY,
    isBlinking,
    eyesClosed,
  ]);

  const shut = isBlinking || eyesClosed;

  return (
    <div
      ref={eyeRef}
      className="flex items-center justify-center rounded-full transition-all duration-150"
      style={{
        width: `${size}px`,
        height: shut ? '2px' : `${size}px`,
        backgroundColor: eyeColor,
        overflow: 'hidden',
      }}
    >
      {!shut && (
        <div
          className="rounded-full"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            transition: 'transform 0.1s ease-out',
          }}
        />
      )}
    </div>
  );
};

export default function AnimatedCharactersLoginPage({
  mode,
  onModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  error,
  loading,
  onSubmit,
  signInAfterConfirmHint,
  showCheckEmail,
  pendingConfirmationEmail,
  onContinueToSignIn,
  onResendConfirmation,
  resendSeconds,
  resendFeedback,
  onGoogleLogin,
}: AnimatedCharactersLoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFieldFocused, setPasswordFieldFocused] = useState(false);
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;

    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsPurpleBlinking(true);
        setTimeout(() => {
          setIsPurpleBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());

      return blinkTimeout;
    };

    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;

    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsBlackBlinking(true);
        setTimeout(() => {
          setIsBlackBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());

      return blinkTimeout;
    };

    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (isTyping) {
      const raf = requestAnimationFrame(() => {
        setIsLookingAtEachOther(true);
      });
      const timer = setTimeout(() => {
        setIsLookingAtEachOther(false);
      }, 800);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
    const raf = requestAnimationFrame(() => {
      setIsLookingAtEachOther(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [isTyping]);

  useEffect(() => {
    if (password.length > 0 && showPassword && !passwordFieldFocused) {
      let cancelled = false;
      let outerId: ReturnType<typeof setTimeout>;

      const runPeekCycle = () => {
        outerId = setTimeout(() => {
          if (cancelled) return;
          setIsPurplePeeking(true);
          setTimeout(() => {
            if (cancelled) return;
            setIsPurplePeeking(false);
            if (!cancelled) runPeekCycle();
          }, 800);
        }, Math.random() * 3000 + 2000);
      };

      runPeekCycle();
      return () => {
        cancelled = true;
        clearTimeout(outerId);
        requestAnimationFrame(() => {
          setIsPurplePeeking(false);
        });
      };
    }
    const id = requestAnimationFrame(() => {
      setIsPurplePeeking(false);
    });
    return () => cancelAnimationFrame(id);
  }, [password, showPassword, passwordFieldFocused]);

  const [purplePos, setPurplePos] = useState({
    faceX: 0,
    faceY: 0,
    bodySkew: 0,
  });
  const [blackPos, setBlackPos] = useState({
    faceX: 0,
    faceY: 0,
    bodySkew: 0,
  });
  const [yellowPos, setYellowPos] = useState({
    faceX: 0,
    faceY: 0,
    bodySkew: 0,
  });
  const [orangePos, setOrangePos] = useState({
    faceX: 0,
    faceY: 0,
    bodySkew: 0,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const calc = (ref: React.RefObject<HTMLDivElement | null>) => {
        if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };

        const rect = ref.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 3;

        const deltaX = mouseX - centerX;
        const deltaY = mouseY - centerY;

        const faceX = Math.max(-15, Math.min(15, deltaX / 20));
        const faceY = Math.max(-10, Math.min(10, deltaY / 30));

        const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));

        return { faceX, faceY, bodySkew };
      };

      setPurplePos(calc(purpleRef));
      setBlackPos(calc(blackRef));
      setYellowPos(calc(yellowRef));
      setOrangePos(calc(orangeRef));
    });
    return () => cancelAnimationFrame(id);
  }, [mouseX, mouseY]);

  const peeking =
    password.length > 0 && showPassword && !passwordFieldFocused;
  const hideEyes = passwordFieldFocused;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-primary/90 via-primary to-primary/80 p-12 text-primary-foreground">
        <div className="relative z-20">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <div className="size-8 rounded-lg bg-primary-foreground/10 backdrop-blur-sm flex items-center justify-center">
              <Sparkles className="size-4" />
            </div>
            <span>Rushi PM</span>
          </div>
        </div>

        <div className="relative z-20 flex items-end justify-center h-[500px]">
          <div className="relative" style={{ width: '550px', height: '400px' }}>
            <div
              ref={purpleRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '70px',
                width: '180px',
                height:
                  isTyping || (password.length > 0 && !showPassword)
                    ? '440px'
                    : '400px',
                backgroundColor: '#6C3FF5',
                borderRadius: '10px 10px 0 0',
                zIndex: 1,
                transform:
                  password.length > 0 && showPassword
                    ? `skewX(0deg)`
                    : isTyping || (password.length > 0 && !showPassword)
                      ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
                      : `skewX(${purplePos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div
                className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                style={{
                  left:
                    password.length > 0 && showPassword
                      ? `${20}px`
                      : isLookingAtEachOther
                        ? `${55}px`
                        : `${45 + purplePos.faceX}px`,
                  top:
                    password.length > 0 && showPassword
                      ? `${35}px`
                      : isLookingAtEachOther
                        ? `${65}px`
                        : `${40 + purplePos.faceY}px`,
                }}
              >
                <EyeBall
                  size={18}
                  pupilSize={7}
                  maxDistance={5}
                  eyeColor="white"
                  pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking}
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : peeking
                        ? isPurplePeeking
                          ? 4
                          : -4
                        : isLookingAtEachOther
                          ? 3
                          : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : peeking
                        ? isPurplePeeking
                          ? 5
                          : -4
                        : isLookingAtEachOther
                          ? 4
                          : undefined
                  }
                />
                <EyeBall
                  size={18}
                  pupilSize={7}
                  maxDistance={5}
                  eyeColor="white"
                  pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking}
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : peeking
                        ? isPurplePeeking
                          ? 4
                          : -4
                        : isLookingAtEachOther
                          ? 3
                          : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : peeking
                        ? isPurplePeeking
                          ? 5
                          : -4
                        : isLookingAtEachOther
                          ? 4
                          : undefined
                  }
                />
              </div>
            </div>

            <div
              ref={blackRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '240px',
                width: '120px',
                height: '310px',
                backgroundColor: '#2D2D2D',
                borderRadius: '8px 8px 0 0',
                zIndex: 2,
                transform:
                  password.length > 0 && showPassword
                    ? `skewX(0deg)`
                    : isLookingAtEachOther
                      ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                      : isTyping || (password.length > 0 && !showPassword)
                        ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
                        : `skewX(${blackPos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div
                className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                style={{
                  left:
                    password.length > 0 && showPassword
                      ? `${10}px`
                      : isLookingAtEachOther
                        ? `${32}px`
                        : `${26 + blackPos.faceX}px`,
                  top:
                    password.length > 0 && showPassword
                      ? `${28}px`
                      : isLookingAtEachOther
                        ? `${12}px`
                        : `${32 + blackPos.faceY}px`,
                }}
              >
                <EyeBall
                  size={16}
                  pupilSize={6}
                  maxDistance={4}
                  eyeColor="white"
                  pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking}
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? 0
                          : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? -4
                          : undefined
                  }
                />
                <EyeBall
                  size={16}
                  pupilSize={6}
                  maxDistance={4}
                  eyeColor="white"
                  pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking}
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? 0
                          : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : isLookingAtEachOther
                          ? -4
                          : undefined
                  }
                />
              </div>
            </div>

            <div
              ref={orangeRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '0px',
                width: '240px',
                height: '200px',
                zIndex: 3,
                backgroundColor: '#FF9B6B',
                borderRadius: '120px 120px 0 0',
                transform:
                  password.length > 0 && showPassword
                    ? `skewX(0deg)`
                    : `skewX(${orangePos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div
                className="absolute flex gap-8 transition-all duration-200 ease-out"
                style={{
                  left:
                    password.length > 0 && showPassword
                      ? `${50}px`
                      : `${82 + (orangePos.faceX || 0)}px`,
                  top:
                    password.length > 0 && showPassword
                      ? `${85}px`
                      : `${90 + (orangePos.faceY || 0)}px`,
                }}
              >
                <Pupil
                  size={12}
                  maxDistance={5}
                  pupilColor="#2D2D2D"
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -5
                        : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : undefined
                  }
                />
                <Pupil
                  size={12}
                  maxDistance={5}
                  pupilColor="#2D2D2D"
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -5
                        : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : undefined
                  }
                />
              </div>
            </div>

            <div
              ref={yellowRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '310px',
                width: '140px',
                height: '230px',
                backgroundColor: '#E8D754',
                borderRadius: '70px 70px 0 0',
                zIndex: 4,
                transform:
                  password.length > 0 && showPassword
                    ? `skewX(0deg)`
                    : `skewX(${yellowPos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div
                className="absolute flex gap-6 transition-all duration-200 ease-out"
                style={{
                  left:
                    password.length > 0 && showPassword
                      ? `${20}px`
                      : `${52 + (yellowPos.faceX || 0)}px`,
                  top:
                    password.length > 0 && showPassword
                      ? `${35}px`
                      : `${40 + (yellowPos.faceY || 0)}px`,
                }}
              >
                <Pupil
                  size={12}
                  maxDistance={5}
                  pupilColor="#2D2D2D"
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -5
                        : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : undefined
                  }
                />
                <Pupil
                  size={12}
                  maxDistance={5}
                  pupilColor="#2D2D2D"
                  eyesClosed={hideEyes}
                  forceLookX={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -5
                        : undefined
                  }
                  forceLookY={
                    hideEyes
                      ? undefined
                      : password.length > 0 && showPassword
                        ? -4
                        : undefined
                  }
                />
              </div>
              <div
                className="absolute w-20 h-[4px] bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out"
                style={{
                  left:
                    password.length > 0 && showPassword
                      ? `${10}px`
                      : `${40 + (yellowPos.faceX || 0)}px`,
                  top:
                    password.length > 0 && showPassword
                      ? `${88}px`
                      : `${88 + (yellowPos.faceY || 0)}px`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="relative z-20 flex items-center gap-8 text-sm text-primary-foreground/60">
          <a href="#" className="hover:text-primary-foreground transition-colors">
            Privacy Policy
          </a>
          <a href="#" className="hover:text-primary-foreground transition-colors">
            Terms of Service
          </a>
          <a href="#" className="hover:text-primary-foreground transition-colors">
            Contact
          </a>
        </div>

        <div
          className="absolute inset-0 opacity-50 bg-[linear-gradient(to_right,oklch(1_0_0_/_0.05)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0_/_0.05)_1px,transparent_1px)] bg-[size:20px_20px]"
          aria-hidden
        />
        <div className="absolute top-1/4 right-1/4 size-64 bg-primary-foreground/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 size-96 bg-primary-foreground/5 rounded-full blur-3xl" />
      </div>

      <div className="flex min-h-screen items-center justify-center p-8 bg-background">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden flex items-center justify-center gap-2 text-lg font-semibold mb-12">
            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="size-4 text-primary" />
            </div>
            <span>Rushi PM</span>
          </div>

          {showCheckEmail && pendingConfirmationEmail ? (
            <div className="space-y-6 text-center lg:text-left">
              <h1 className="text-3xl font-bold tracking-tight">
                Check your email
              </h1>
              <div
                className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <p>
                  Confirm your email before signing in. We sent a link to{' '}
                  <strong className="text-foreground">
                    {pendingConfirmationEmail}
                  </strong>
                  .
                </p>
                <p className="mt-2">
                  Didn&apos;t get it? Check spam or promotions.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  className="h-12 w-full text-base font-medium"
                  size="lg"
                  onClick={onContinueToSignIn}
                >
                  Continue to sign in
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full border-border/60 bg-background hover:bg-accent"
                  disabled={resendSeconds > 0}
                  onClick={onResendConfirmation}
                >
                  {resendSeconds > 0
                    ? `Resend email (${resendSeconds}s)`
                    : 'Resend confirmation email'}
                </Button>
                {resendFeedback ? (
                  <p
                    className={
                      resendFeedback.type === 'ok'
                        ? 'text-sm text-emerald-500'
                        : 'text-sm text-destructive'
                    }
                  >
                    {resendFeedback.text}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="text-center mb-10 lg:text-left">
                <h1 className="text-3xl font-bold tracking-tight mb-2">
                  {mode === 'signin' ? 'Welcome back!' : 'Create your account'}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {mode === 'signin'
                    ? 'Please enter your details'
                    : 'Sign up with your email and password'}
                </p>
              </div>

              {signInAfterConfirmHint ? (
                <p
                  className="mb-4 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3 text-sm text-emerald-400"
                  role="status"
                  aria-live="polite"
                >
                  After you confirm your email, sign in below.
                </p>
              ) : null}

              <form onSubmit={onSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => onEmailChange(e.target.value)}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    required
                    className="h-12 bg-background border-border/60 focus-visible:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => onPasswordChange(e.target.value)}
                      onFocus={() => setPasswordFieldFocused(true)}
                      onBlur={() => setPasswordFieldFocused(false)}
                      autoComplete={
                        mode === 'signup' ? 'new-password' : 'current-password'
                      }
                      required
                      minLength={6}
                      className="h-12 pr-10 bg-background border-border/60 focus-visible:border-primary"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox id="remember" />
                    <Label
                      htmlFor="remember"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Remember for 30 days
                    </Label>
                  </div>
                  <a
                    href="#"
                    className="text-sm text-primary hover:underline font-medium shrink-0"
                  >
                    Forgot password?
                  </a>
                </div>

                {error ? (
                  <div className="p-3 text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-medium"
                  size="lg"
                  disabled={loading}
                >
                  {loading
                    ? '…'
                    : mode === 'signin'
                      ? 'Log in'
                      : 'Sign up'}
                </Button>
              </form>

              {onGoogleLogin ? (
                <div className="mt-6">
                  <Button
                    variant="outline"
                    className="w-full h-12 bg-background border-border/60 hover:bg-accent"
                    type="button"
                    onClick={onGoogleLogin}
                  >
                    <Mail className="mr-2 size-5" />
                    Log in with Google
                  </Button>
                </div>
              ) : null}

              <div className="text-center text-sm text-muted-foreground mt-8">
                {mode === 'signin' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      className="text-foreground font-medium hover:underline"
                      onClick={() => {
                        onModeChange('signup');
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
                      className="text-foreground font-medium hover:underline"
                      onClick={() => onModeChange('signin')}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const Component = AnimatedCharactersLoginPage;
