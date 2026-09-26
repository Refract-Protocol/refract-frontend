import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { WalletProvider } from '@/lib/wallet/WalletProvider';
import { StoreProvider } from '@/lib/store/StoreProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Handsoff',
  description: 'Handsoff app',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <StoreProvider>
          <WalletProvider>{children}</WalletProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
