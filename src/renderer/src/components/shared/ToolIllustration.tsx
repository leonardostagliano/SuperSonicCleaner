import { useLocation } from 'react-router-dom'
import { File, Folder, ShieldCheck, Cpu } from 'lucide-react'
import { pageExperiences } from '@/components/layout/page-experiences'
import { icons } from '@/lib/icons'
import { crumbFor, navLeafFor } from '@/lib/navigation'

/** Artwork family by sidebar group (the kickers that used to carry it are gone). */
const familyByGroup: Record<string, string> = {
  '/disk': 'storage',
  '/malware': 'protection',
  '/performance': 'performance'
}

/** Decorative, code-native artwork. It never represents file counts, scan findings, or telemetry. */
export function ToolIllustration() {
  const { pathname } = useLocation()
  const experience = pageExperiences[pathname]
  const Icon = navLeafFor(pathname)?.icon ?? icons.clean
  const family = familyByGroup[crumbFor(pathname)?.group.path ?? '']
  const storage = family === 'storage'
  const protection = family === 'protection'
  const Satellite = protection ? ShieldCheck : storage ? File : Cpu
  return (
    <div
      className="pulse-tool-art"
      data-family={family}
      data-tool={experience?.key}
      aria-hidden="true"
    >
      <svg className="pulse-art-connectors" viewBox="0 0 320 170">
        <path d="M66 43 H124 Q144 43 144 63 V85 H176 M66 127 H124 Q144 127 144 107 V85 M176 85 H226 Q244 85 244 65 V43 H274 M176 85 H226 Q244 85 244 105 V127 H274" />
      </svg>
      <div className="pulse-art-node node-one">
        <Satellite size={24} strokeWidth={1.35} />
      </div>
      <div className="pulse-art-node node-two">
        {storage ? (
          <Folder size={25} strokeWidth={1.35} />
        ) : (
          <Satellite size={23} strokeWidth={1.35} />
        )}
      </div>
      <div className="pulse-art-core">
        <Icon size={36} strokeWidth={1.35} />
      </div>
      <div className="pulse-art-slat slat-one">
        <i />
        <span />
        <span />
      </div>
      <div className="pulse-art-slat slat-two">
        <i />
        <span />
        <span />
      </div>
    </div>
  )
}
