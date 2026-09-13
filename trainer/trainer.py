#!/usr/bin/env python3
import argparse,json,os,sys,zipfile,hashlib,shutil,time

def check():
    d={'python':sys.version.split()[0],'ready':False,'torch':False,'transformers':False,'peft':False,'cuda':False}
    try:
        import torch; d['torch']=True; d['cuda']=bool(torch.cuda.is_available())
        import transformers; d['transformers']=True
        import peft; d['peft']=True
        d['ready']=True
    except Exception as e: d['error']=str(e)
    print(json.dumps(d))

def mock_train(args, rows):
    ad=os.path.join(args.output,'adapter');os.makedirs(ad,exist_ok=True)
    open(os.path.join(ad,'adapter_config.json'),'w').write(json.dumps({'peft_type':'LORA','base_model_name_or_path':args.base_model,'r':args.lora_rank,'lora_alpha':args.lora_alpha},indent=2))
    seed=hashlib.sha256((''.join(x['instruction']+x['response'] for x in rows)).encode()).digest()
    open(os.path.join(ad,'adapter_model.safetensors'),'wb').write(seed*128)
    return {'loss':0.42,'score':0.82,'mode':'mock','samples':len(rows)}

def real_train(args, rows):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig,get_peft_model
    tok=AutoTokenizer.from_pretrained(args.base_model,trust_remote_code=True)
    if tok.pad_token is None: tok.pad_token=tok.eos_token
    dtype=torch.float16 if torch.cuda.is_available() else torch.float32
    model=AutoModelForCausalLM.from_pretrained(args.base_model,torch_dtype=dtype,device_map='auto' if torch.cuda.is_available() else None,trust_remote_code=True)
    cfg=LoraConfig(r=args.lora_rank,lora_alpha=args.lora_alpha,lora_dropout=0.05,bias='none',task_type='CAUSAL_LM',target_modules=['q_proj','k_proj','v_proj','o_proj'])
    model=get_peft_model(model,cfg)
    texts=[f"<|user|>\n{x['instruction']}\n<|assistant|>\n{x['response']}" for x in rows]
    class DS(torch.utils.data.Dataset):
        def __len__(self): return len(texts)
        def __getitem__(self,i):
            z=tok(texts[i],truncation=True,max_length=1024); z['labels']=z['input_ids'].copy(); return z
    out=os.path.join(args.output,'adapter');os.makedirs(out,exist_ok=True)
    ta=TrainingArguments(output_dir=os.path.join(args.output,'checkpoints'),num_train_epochs=args.epochs,per_device_train_batch_size=args.batch_size,learning_rate=args.learning_rate,logging_steps=1,save_strategy='no',report_to=[],fp16=torch.cuda.is_available(),remove_unused_columns=False)
    tr=Trainer(model=model,args=ta,train_dataset=DS(),data_collator=DataCollatorForLanguageModeling(tok,mlm=False)); result=tr.train();model.save_pretrained(out);tok.save_pretrained(out)
    loss=float(getattr(result,'training_loss',0) or 0);score=max(0.5,min(.98,1/(1+loss)))
    return {'loss':loss,'score':score,'mode':'peft','samples':len(rows),'cuda':bool(torch.cuda.is_available())}

def bundle_dir(src,dst):
    with zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as z:
        for root,_,files in os.walk(src):
            for f in files:z.write(os.path.join(root,f),os.path.relpath(os.path.join(root,f),src))

def train(args):
    rows=[json.loads(x) for x in open(args.dataset,encoding='utf8') if x.strip()]
    if not rows: raise RuntimeError('empty training dataset')
    metrics=mock_train(args,rows) if args.mode=='mock' else real_train(args,rows)
    bundle=os.path.join(args.output,'adapter.zip');bundle_dir(os.path.join(args.output,'adapter'),bundle)
    open(os.path.join(args.output,'metrics.json'),'w').write(json.dumps(metrics,indent=2))
    print(json.dumps({'ok':True,'bundle':bundle,'metrics':metrics}))

def unpack(args):
    os.makedirs(args.output,exist_ok=True)
    with zipfile.ZipFile(args.bundle) as z:z.extractall(args.output)
    print(json.dumps({'ok':True,'output':args.output}))

def main():
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest='cmd');ap.add_argument('--check',action='store_true')
    t=sub.add_parser('train');t.add_argument('--dataset',required=True);t.add_argument('--output',required=True);t.add_argument('--base-model',required=True);t.add_argument('--epochs',type=float,default=1);t.add_argument('--batch-size',type=int,default=1);t.add_argument('--learning-rate',type=float,default=2e-4);t.add_argument('--lora-rank',type=int,default=8);t.add_argument('--lora-alpha',type=int,default=16);t.add_argument('--mode',choices=['mock','peft'],default='peft')
    u=sub.add_parser('unpack');u.add_argument('--bundle',required=True);u.add_argument('--output',required=True)
    a=ap.parse_args()
    if a.check: return check()
    if a.cmd=='train': return train(a)
    if a.cmd=='unpack': return unpack(a)
    ap.print_help()
if __name__=='__main__': main()
