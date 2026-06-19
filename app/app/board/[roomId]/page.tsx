import type { Metadata } from 'next';
import BoardClient from '@/components/BoardClient';

interface BoardPageProps {
  params: Promise<{ roomId: string }>;
}

export async function generateMetadata({ params }: BoardPageProps): Promise<Metadata> {
  const { roomId } = await params;
  return {
    title: `Board ${roomId} -- Synapse`,
    description: `Collaborative whiteboard session ${roomId}`,
  };
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { roomId } = await params;

  return <BoardClient roomId={roomId} />;
}
