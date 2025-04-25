
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300",
        scrolled ? "nav-blur" : "bg-transparent"
      )}
    >
      <div className="container flex h-full items-center justify-between max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-6">
          <Link 
            to="/" 
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <div className="flex items-center justify-center rounded-lg bg-primary/10 text-primary p-2">
              <FolderOpen className="h-5 w-5" />
            </div>
            <span>DataVision</span>
          </Link>
        </div>
        
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "transition-colors",
              location.pathname === "/" && "bg-accent text-accent-foreground"
            )}
            asChild
          >
            <Link to="/">Projects</Link>
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            asChild
          >
            <Link to="/api-settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
