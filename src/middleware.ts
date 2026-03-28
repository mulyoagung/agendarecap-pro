import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const dummyAuth = request.cookies.get("dummy_auth")?.value === "true";
  const isAuthValid = user !== null || dummyAuth;

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname === '/login';

  const protectedRoutes = ['/', '/settings', '/admin', '/dashboard', '/waiting-approval'];
  const isProtectedRoute = protectedRoutes.some(route => 
    pathname === route || (route !== '/' && pathname.startsWith(route))
  );

  if (!isAuthValid && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Profile check if user is authenticated via Supabase (not dummy)
  if (user && isProtectedRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .single();

    const status = profile?.status || 'pending';
    const role = profile?.role || 'user';

    // Redirect pending users to waiting approval
    if (status === 'pending' && pathname !== '/waiting-approval') {
      const url = request.nextUrl.clone();
      url.pathname = '/waiting-approval';
      return NextResponse.redirect(url);
    }

    // Redirect approved users AWAY from waiting approval
    if (status === 'approved' && pathname === '/waiting-approval') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }

    // Redirect non-admins trying to access admin panel
    if (pathname.startsWith('/admin') && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  if (isAuthValid && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
