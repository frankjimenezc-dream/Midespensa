import "./globals.css";

export const metadata = {
  title: "Mi Despensa",
  description: "Control inteligente de tu despensa",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
