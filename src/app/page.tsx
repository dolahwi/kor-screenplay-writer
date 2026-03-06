'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'

const Editor = dynamic(() => import('@/components/Editor'), { ssr: false })
const BeatBoard = dynamic(() => import('@/components/BeatBoard'), { ssr: false })

export default function Home() {
  const [view, setView] = useState<'writer' | 'board'>('writer')
  const [beatBoardData, setBeatBoardData] = useState<any>(null)
  const [documentData, setDocumentData] = useState<any>(null)
  const [titlePageData, setTitlePageData] = useState<any>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration.scope);
        })
        .catch((error) => {
          console.log('SW registration failed:', error);
        });
    }
  }, [])


  return (
    <main className="relative w-full h-full bg-white dark:bg-zinc-950">
      {view === 'writer' ? (
        <Editor
          onViewChange={(newView, doc, title) => {
            if (doc) setDocumentData(doc);
            if (title) setTitlePageData(title);
            setView(newView);
          }}
          currentBeatBoardData={beatBoardData}
          onBeatBoardDataLoaded={setBeatBoardData}
          initialDocumentData={documentData}
          initialTitlePage={titlePageData}
        />
      ) : (
        <BeatBoard
          onViewChange={(newView, data) => {
            if (data) setBeatBoardData(data);
            setView(newView);
          }}
          initialData={beatBoardData}
        />
      )}
    </main>
  );
}
