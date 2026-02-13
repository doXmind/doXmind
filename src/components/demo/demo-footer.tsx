import Link from "next/link";

const footerLinks = [
  {
    title: "Product",
    links: [
      { label: "AI Editor", href: "/help" },
      { label: "AI Chat", href: "/help" },
      { label: "Knowledge Base", href: "/help" },
      { label: "Presentation Mode", href: "/help" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", href: "/help" },
      { label: "Get Started", href: "/login" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Use", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
];

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.8187 2H13.8544L9.407 7.08308L14.639 14H10.5424L7.33377 9.80492L3.66239 14H1.62547L6.38239 8.56308L1.36331 2H5.56393L8.46424 5.83446L11.8187 2ZM11.1042 12.7815H12.2322L4.951 3.15446H3.74054L11.1042 12.7815Z"
        fill="currentColor"
      />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.4695 2.67188C14.0722 2.85846 14.5459 3.4062 14.7073 4.10321C14.9988 5.36528 15 8.00004 15 8.00004C15 8.00004 15 10.6348 14.7073 11.8969C14.5459 12.5939 14.0722 13.1416 13.4695 13.3282C12.3782 13.6667 7.99998 13.6667 7.99998 13.6667C7.99998 13.6667 3.62183 13.6667 2.53045 13.3282C1.92773 13.1416 1.45407 12.5939 1.29272 11.8969C1 10.6348 1 8.00004 1 8.00004C1 8.00004 1 5.36528 1.29272 4.10321C1.45407 3.4062 1.92773 2.85846 2.53045 2.67188C3.62183 2.33337 7.99998 2.33337 7.99998 2.33337C7.99998 2.33337 12.3782 2.33337 13.4695 2.67188ZM10.3422 8.00025L6.5319 10.2V5.80048L10.3422 8.00025Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13.1 2H2.9C2.66131 2 2.43239 2.09482 2.2636 2.2636C2.09482 2.43239 2 2.66131 2 2.9V13.1C2 13.3387 2.09482 13.5676 2.2636 13.7364C2.43239 13.9052 2.66131 14 2.9 14H13.1C13.3387 14 13.5676 13.9052 13.7364 13.7364C13.9052 13.5676 14 13.3387 14 13.1V2.9C14 2.66131 13.9052 2.43239 13.7364 2.2636C13.5676 2.09482 13.3387 2 13.1 2ZM5.6 12.2H3.8V6.8H5.6V12.2ZM4.7 5.75C4.49371 5.7441 4.29373 5.67755 4.12505 5.55865C3.95637 5.43974 3.82647 5.27377 3.75158 5.08147C3.67669 4.88916 3.66012 4.67905 3.70396 4.47738C3.7478 4.27572 3.8501 4.09144 3.99807 3.94758C4.14604 3.80372 4.33312 3.70666 4.53594 3.66852C4.73876 3.63038 4.94832 3.65285 5.13844 3.73313C5.32856 3.8134 5.49081 3.94793 5.60491 4.11989C5.71902 4.29185 5.77992 4.49363 5.78 4.7C5.77526 4.98221 5.659 5.25107 5.45663 5.44782C5.25426 5.64457 4.98223 5.75321 4.7 5.75ZM12.2 12.2H10.4V9.356C10.4 8.504 10.04 8.198 9.572 8.198C9.43479 8.20714 9.30073 8.24329 9.17753 8.30439C9.05433 8.36548 8.94441 8.45032 8.85409 8.55402C8.76377 8.65771 8.69483 8.77824 8.65123 8.90866C8.60762 9.03908 8.59021 9.17683 8.6 9.314C8.59702 9.34192 8.59702 9.37008 8.6 9.398V12.2H6.8V6.8H8.54V7.58C8.71552 7.313 8.95666 7.09554 9.24031 6.94846C9.52397 6.80138 9.84065 6.7296 10.16 6.74C11.09 6.74 12.176 7.256 12.176 8.936L12.2 12.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="17"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.99998 1.30048C11.6833 1.30048 14.6666 4.28381 14.6666 7.96714C14.6663 9.36398 14.2279 10.7255 13.4132 11.8602C12.5985 12.9948 11.4484 13.8454 10.125 14.2921C9.79165 14.3588 9.66665 14.1505 9.66665 13.9755C9.66665 13.7505 9.67498 13.0338 9.67498 12.1421C9.67498 11.5171 9.46665 11.1171 9.22498 10.9088C10.7083 10.7421 12.2666 10.1755 12.2666 7.61714C12.2666 6.88381 12.0083 6.29214 11.5833 5.82548C11.65 5.65881 11.8833 4.97548 11.5166 4.05881C11.5166 4.05881 10.9583 3.87548 9.68331 4.74214C9.14998 4.59214 8.58331 4.51714 8.01665 4.51714C7.44998 4.51714 6.88331 4.59214 6.34998 4.74214C5.07498 3.88381 4.51665 4.05881 4.51665 4.05881C4.14998 4.97548 4.38331 5.65881 4.44998 5.82548C4.02498 6.29214 3.76665 6.89214 3.76665 7.61714C3.76665 10.1671 5.31665 10.7421 6.79998 10.9088C6.60831 11.0755 6.43331 11.3671 6.37498 11.8005C5.99165 11.9755 5.03331 12.2588 4.43331 11.2505C4.30831 11.0505 3.93331 10.5588 3.40831 10.5671C2.84998 10.5755 3.18331 10.8838 3.41665 11.0088C3.69998 11.1671 4.02498 11.7588 4.09998 11.9505C4.23331 12.3255 4.66665 13.0421 6.34165 12.7338C6.34165 13.2921 6.34998 13.8171 6.34998 13.9755C6.34998 14.1505 6.22498 14.3505 5.89165 14.2921C4.56385 13.8502 3.40893 13.0013 2.59072 11.866C1.77252 10.7307 1.33258 9.36657 1.33331 7.96714C1.33331 4.28381 4.31665 1.30048 7.99998 1.30048Z"
        fill="currentColor"
      />
    </svg>
  );
}

const socialLinks = [
  { label: "X", href: "https://x.com/doxmindofficial", icon: XIcon },
  { label: "YouTube", href: "https://www.youtube.com/@doxmind-official", icon: YouTubeIcon },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/doxmind/", icon: LinkedInIcon },
  { label: "GitHub", href: "https://github.com/doXmind", icon: GitHubIcon },
];

export function DemoFooter() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 text-zinc-400">
      {/* Link columns */}
      <div className="mx-auto max-w-7xl px-6 pb-12 pt-16">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerLinks.map((group) => (
            <div key={group.title}>
              <h3 className="mb-4 text-sm font-medium text-zinc-500">{group.title}</h3>
              <ul className="space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-zinc-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          {/* Social icons — left */}
          <div className="flex items-center gap-3">
            {socialLinks.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/30 transition-colors duration-200 hover:text-white"
                aria-label={label}
              >
                <Icon />
              </a>
            ))}
          </div>

          {/* Copyright — right */}
          <p className="text-sm text-white/30">&copy; {new Date().getFullYear()} W Aixs Inc.</p>
        </div>
      </div>
    </footer>
  );
}
