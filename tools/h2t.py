import sys,re,html
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.out=[]; s.skip=0; s.art=False
    def handle_starttag(s,t,a):
        d=dict(a)
        if t in ('script','style','nav','svg','head'): s.skip+=1
        if t in ('p','div','li','tr','h1','h2','h3','h4','br','section','pre'): s.out.append('\n')
        if t=='article': s.art=True
    def handle_endtag(s,t):
        if t in ('script','style','nav','svg','head'): s.skip=max(0,s.skip-1)
        if t in ('p','div','li','tr','h1','h2','h3','h4','pre'): s.out.append('\n')
    def handle_data(s,d):
        if not s.skip: s.out.append(d)
p=P(); p.feed(open(sys.argv[1],encoding='utf-8',errors='ignore').read())
t=''.join(p.out)
t=re.sub(r'[ \t]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
print(t.strip())
